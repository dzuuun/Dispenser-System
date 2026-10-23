import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { REQUEST_PERMISSION_KEYS } from "../../shared/request-permissions.mjs";
import {
  encryptPassword,
  decryptPassword,
} from "../services/encryption.service.js";
import { completePasswordResetRequest } from "../controllers/password-reset.controller.js";

after(() => pool.end());
const reviewToken = "a".repeat(64);

function setup(t, options = {}) {
  const stored = {
    account: encryptPassword("Original test password"),
    completed: false,
  };
  const expectedTable = {
    EMAIL: "institutional_email_accounts",
    KUMOSOFT: "kumosoft_accounts",
    SCHOOLOGY: "schoology_accounts",
  }[options.type || "EMAIL"];
  let staged;
  const connection = {
    async beginTransaction() {
      staged = structuredClone(stored);
    },
    async commit() {
      Object.assign(stored, staged);
    },
    async rollback() {
      staged = null;
    },
    release() {},
    async execute(sql, values) {
      if (sql.startsWith("SELECT r.")) return [[{admin_user_id:1,review_token:reviewToken,is_live:1}]];
      if (sql.startsWith('DELETE FROM credential_request_reviews')) return [{affectedRows:1}];
      if (sql.startsWith("SELECT student_id, credential_type, request_kind"))
        return [
          options.pending === false
            ? []
            : [
                {
                  student_id: 7,
                  credential_type: options.type || "EMAIL",
                  request_kind: options.kind || "PASSWORD_RESET",
                },
              ],
        ];
      if (
        sql ===
        `SELECT id, is_active FROM ${expectedTable} WHERE student_id=? FOR UPDATE`
      )
        return [
          options.missingAccount
            ? []
            : [{ id: 10, is_active: options.inactive ? 0 : 1 }],
        ];
      if (sql.startsWith(`UPDATE ${expectedTable} SET encrypted_password=`)) {
        assert.equal(values[3], 10);
        staged.account = {
          encrypted_password: values[0],
          password_iv: values[1],
          password_auth_tag: values[2],
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE password_reset_requests")) {
        if (options.failCompletion)
          throw new Error("Simulated completion failure");
        if (options.noCompletionRows) return [{ affectedRows: 0 }];
        staged.completed = true;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  t.mock.method(pool, "getConnection", async () => connection);
  const req = {
    params: { id: "1" },
    admin: { sub: 1, requestPermissions: [...REQUEST_PERMISSION_KEYS] },
    body: { reviewToken },
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return { req, res, stored };
}

for (const type of ["EMAIL", "KUMOSOFT", "SCHOOLOGY"]) {
  test(`${type}: normal completion preserves the existing default password`, async (t) => {
    const { req, res, stored } = setup(t, { type });
    await completePasswordResetRequest(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(decryptPassword(stored.account), "Original test password");
    assert.equal(stored.completed, true);
  });

  test(`${type}: replacement is encrypted and saved with request completion`, async (t) => {
    const { req, res, stored } = setup(t, { type });
    req.body = { reviewToken, replacePassword: true, password: " New test password " };
    await completePasswordResetRequest(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(decryptPassword(stored.account), req.body.password);
    assert.notEqual(stored.account.encrypted_password, req.body.password);
    assert.equal(stored.completed, true);
    assert.ok(!JSON.stringify(res.body).includes(req.body.password));
  });

  for (const password of [undefined, "", "   ", 123]) {
    test(`${type}: invalid replacement (${JSON.stringify(password)}) cannot complete the request`, async (t) => {
      const { req, res, stored } = setup(t, { type });
      req.body = { reviewToken, replacePassword: true, password };
      await completePasswordResetRequest(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(decryptPassword(stored.account), "Original test password");
      assert.equal(stored.completed, false);
    });
  }
  test(`${type}: a completion failure rolls back the replacement password`, async (t) => {
    const { req, res, stored } = setup(t, { type, failCompletion: true });
    req.body = { reviewToken, replacePassword: true, password: "New test password" };
    await assert.rejects(
      completePasswordResetRequest(req, res),
      /Simulated completion failure/,
    );
    assert.equal(decryptPassword(stored.account), "Original test password");
    assert.equal(stored.completed, false);
  });
  for (const options of [
    { missingAccount: true },
    { inactive: true },
    { noCompletionRows: true },
  ]) {
    test(`${type}: unavailable account or changed request leaves the password unchanged: ${JSON.stringify(options)}`, async (t) => {
      const { req, res, stored } = setup(t, { type, ...options });
      req.body = { reviewToken, replacePassword: true, password: "New test password" };
      await completePasswordResetRequest(req, res);
      assert.equal(res.statusCode, 404);
      assert.equal(decryptPassword(stored.account), "Original test password");
      assert.equal(stored.completed, false);
    });
  }
}

for (const options of [
  { type: "SATP", status: 400 },
  { type: "VOUCHER", kind: "VOUCHER_REQUEST", status: 400 },
  { kind: "ACCOUNT_CREATION", status: 400 },
  { pending: false, status: 404 },
  { missingAccount: true, status: 404 },
  { inactive: true, status: 404 },
  { noCompletionRows: true, status: 404 },
]) {
  test(`replacement rejects unavailable or unsupported requests: ${JSON.stringify(options)}`, async (t) => {
    const { req, res, stored } = setup(t, options);
    req.body = { reviewToken, replacePassword: true, password: "New test password" };
    await completePasswordResetRequest(req, res);
    assert.equal(res.statusCode, options.status);
    assert.equal(decryptPassword(stored.account), "Original test password");
    assert.equal(stored.completed, false);
  });
}
