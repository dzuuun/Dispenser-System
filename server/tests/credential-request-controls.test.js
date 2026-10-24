import assert from "node:assert/strict";
import { after, test } from "node:test";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import {
  listModuleControls,
  publicModuleControls,
  updateModuleControl,
} from "../controllers/module-control.controller.js";
import {
  requestAccount,
  requestPasswordReset,
} from "../controllers/kiosk.controller.js";
import { ensureCredentialRequestControlsSchema } from "../services/credential-request-controls.service.js";

after(() => pool.end());

function setup(t) {
  const controls = [
    "EMAIL",
    "KUMOSOFT",
    "SCHOOLOGY",
    "SATP",
    "VOUCHER",
    "KIOSK",
    "PASSWORD_RESET_REQUEST",
  ].map((module_key) => ({
    module_key,
    is_visible: 1,
    is_maintenance: 0,
    accept_password_resets: 1,
    accept_account_requests: 1,
  }));
  const calls = [],
    writes = [];
  let connections = 0;
  t.mock.method(pool, "query", async (sql) => {
    calls.push(sql);
    assert.match(sql, /FROM credential_module_controls/);
    return [
      structuredClone(
        controls.filter(
          (row) =>
            !sql.includes("WHERE module_key<>") ||
            row.module_key !== "PASSWORD_RESET_REQUEST",
        ),
      ),
    ];
  });
  t.mock.method(pool, "execute", async (sql, values) => {
    calls.push(sql);
    if (sql.includes("FROM kiosk_credential_sessions"))
      return [[{ student_id: 7 }]];
    if (sql.startsWith("SELECT is_maintenance"))
      return [
        [controls.find((row) => row.module_key === values[0])].filter(Boolean),
      ];
    if (sql.startsWith("UPDATE credential_module_controls")) {
      writes.push({ sql, values });
      const row = controls.find((row) => row.module_key === values.at(-1));
      sql
        .split(" SET ")[1]
        .split(" WHERE ")[0]
        .split(", ")
        .forEach((assignment, index) => {
          row[assignment.split("=")[0]] = Number(values[index]);
        });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected control query: ${sql}`);
  });
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, values) {
      calls.push(sql);
      if (sql.startsWith("SELECT c.academic_level"))
        return [[{ academic_level: "COLLEGE" }]];
      if (sql.startsWith("SELECT id, is_active FROM")) return [[]];
      if (sql.startsWith("SELECT id FROM password_reset_requests")) return [[]];
      if (sql.startsWith("SELECT id FROM")) return [[{ id: 10 }]];
      if (sql.startsWith("INSERT INTO password_reset_requests")) {
        writes.push({ sql, values });
        return [{ insertId: writes.length }];
      }
      throw new Error(`Unexpected request query: ${sql}`);
    },
  };
  t.mock.method(pool, "getConnection", async () => {
    connections++;
    return connection;
  });
  const token = jwt.sign(
    { sub: 7, jti: "test-session", scope: "kiosk-credentials" },
    config().accessSecret,
  );
  const res = () => ({
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set() {
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  });
  const update = async (module, body) => {
    const response = res();
    await updateModuleControl({ params: { module }, body }, response);
    return response;
  };
  const submit = async (type, kind) => {
    const response = res();
    await (kind === "PASSWORD_RESET" ? requestPasswordReset : requestAccount)(
      {
        headers: { authorization: `Bearer ${token}` },
        body: {
          credentialType: type,
          acceptPasswordResets: true,
          acceptAccountRequests: true,
        },
        kioskCode: "TEST-KIOSK",
      },
      response,
    );
    return response;
  };
  return {
    controls,
    calls,
    writes,
    update,
    submit,
    res,
    connections: () => connections,
  };
}

for (const type of ["EMAIL", "KUMOSOFT", "SCHOOLOGY"]) {
  test(`${type}: password resets and new-account requests are enforced independently by the API`, async (t) => {
    const { controls, update, submit, connections } = setup(t);
    assert.equal(
      (await update(type, { acceptPasswordResets: false })).statusCode,
      200,
    );
    assert.equal((await submit(type, "PASSWORD_RESET")).statusCode, 503);
    assert.equal(
      connections(),
      0,
      "A rejected request must not lock or write account records",
    );
    assert.equal((await submit(type, "ACCOUNT_CREATION")).statusCode, 201);
    assert.equal(
      (
        await update(type, {
          acceptAccountRequests: false,
          acceptPasswordResets: true,
        })
      ).statusCode,
      200,
    );
    const before = connections();
    assert.equal((await submit(type, "ACCOUNT_CREATION")).statusCode, 503);
    assert.equal(connections(), before);
    assert.equal((await submit(type, "PASSWORD_RESET")).statusCode, 201);
    for (const row of controls.filter((item) => item.module_key !== type)) {
      assert.equal(row.accept_password_resets, 1);
      assert.equal(row.accept_account_requests, 1);
    }
  });
}

test("retired master switch cannot override the individual credential switches", async (t) => {
  const { update, submit, controls } = setup(t);
  controls.find(
    (row) => row.module_key === "PASSWORD_RESET_REQUEST",
  ).is_visible = 0;
  assert.equal(
    (await update("PASSWORD_RESET_REQUEST", { isVisible: true })).statusCode,
    404,
  );
  for (const type of ["EMAIL", "KUMOSOFT", "SCHOOLOGY"]) {
    assert.equal((await submit(type, "PASSWORD_RESET")).statusCode, 201);
    assert.equal((await submit(type, "ACCOUNT_CREATION")).statusCode, 201);
  }
  await update("EMAIL", { acceptPasswordResets: false });
  assert.equal((await submit("EMAIL", "PASSWORD_RESET")).statusCode, 503);
  assert.equal((await submit("KUMOSOFT", "PASSWORD_RESET")).statusCode, 201);
  assert.equal(
    controls.find((row) => row.module_key === "EMAIL").accept_account_requests,
    1,
  );
});

test("visibility and maintenance continue to block both kinds of requests", async (t) => {
  const { update, submit, connections } = setup(t);
  for (const setting of [
    { isVisible: false },
    { isVisible: true, isMaintenance: true },
  ]) {
    await update("EMAIL", setting);
    assert.equal((await submit("EMAIL", "PASSWORD_RESET")).statusCode, 503);
    assert.equal((await submit("EMAIL", "ACCOUNT_CREATION")).statusCode, 503);
  }
  assert.equal(connections(), 0);
});

test("admin and kiosk control reads expose persisted request switches", async (t) => {
  const { update, res, calls } = setup(t);
  await update("EMAIL", { acceptAccountRequests: false });
  for (const read of [listModuleControls, publicModuleControls]) {
    const response = res();
    await read({}, response);
    assert.equal(
      response.body.some((row) => row.module_key === "PASSWORD_RESET_REQUEST"),
      false,
    );
    const email = response.body.find((row) => row.module_key === "EMAIL");
    assert.equal(email.accept_account_requests, 0);
    assert.equal(email.accept_password_resets, 1);
  }
  assert.ok(
    calls
      .filter(
        (sql) =>
          sql.includes("FROM credential_module_controls") &&
          sql.startsWith("SELECT module_key"),
      )
      .every((sql) =>
        sql.includes("accept_password_resets, accept_account_requests"),
      ),
  );
});

test("SATP and non-account modules cannot acquire request toggles", async (t) => {
  const { update, writes, submit } = setup(t);
  for (const type of ["SATP", "VOUCHER", "KIOSK"])
    for (const field of ["acceptPasswordResets", "acceptAccountRequests"])
      assert.equal((await update(type, { [field]: true })).statusCode, 400);
  assert.equal(
    (await update("PASSWORD_RESET_REQUEST", { acceptPasswordResets: true }))
      .statusCode,
    404,
  );
  assert.equal((await submit("SATP", "PASSWORD_RESET")).statusCode, 400);
  assert.equal(writes.length, 0);
});

test("malformed settings and empty updates cannot partially change controls", async (t) => {
  const { update, writes } = setup(t);
  for (const value of [null, 0, 1, "false", [], {}]) {
    assert.equal(
      (
        await update("EMAIL", {
          acceptPasswordResets: value,
          acceptAccountRequests: true,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await update("EMAIL", { acceptAccountRequests: value })).statusCode,
      400,
    );
  }
  assert.equal((await update("EMAIL", {})).statusCode, 400);
  assert.equal(
    (await update("UNKNOWN", { acceptAccountRequests: true })).statusCode,
    404,
  );
  assert.equal(writes.length, 0);
});

test("request-control schema upgrades are additive, repeatable, and preserve saved switches", async () => {
  const columns = new Set();
  const writes = [];
  const saved = { EMAIL: 1, KUMOSOFT: 1, SCHOOLOGY: 1 };
  const executor = {
    async query(sql) {
      if (sql.startsWith("SELECT"))
        return [[...columns].map((COLUMN_NAME) => ({ COLUMN_NAME }))];
      if (sql.startsWith("UPDATE")) {
        assert.match(sql, /legacy\.module_key='PASSWORD_RESET_REQUEST'/);
        assert.match(
          sql,
          /SET current_control\.accept_password_resets=legacy\.is_visible/,
        );
        assert.match(
          sql,
          /WHERE current_control\.module_key IN \('EMAIL','KUMOSOFT','SCHOOLOGY'\)/,
        );
        for (const type of Object.keys(saved)) saved[type] = 0;
        writes.push(sql);
        return [{}];
      }
      assert.match(
        sql,
        /^ALTER TABLE credential_module_controls ADD COLUMN (accept_password_resets|accept_account_requests) BOOLEAN NOT NULL DEFAULT TRUE$/,
      );
      writes.push(sql);
      columns.add(sql.split(" ")[5]);
      return [{}];
    },
  };
  await ensureCredentialRequestControlsSchema(executor);
  assert.deepEqual(saved, { EMAIL: 0, KUMOSOFT: 0, SCHOOLOGY: 0 });
  saved.EMAIL = 1;
  await ensureCredentialRequestControlsSchema(executor);
  assert.equal(writes.length, 3);
  assert.equal(
    saved.EMAIL,
    1,
    "Restart must preserve changes made after the one-time migration",
  );
  assert.deepEqual(
    [...columns],
    ["accept_password_resets", "accept_account_requests"],
  );
  await assert.rejects(
    ensureCredentialRequestControlsSchema({
      query: async () => {
        throw new Error("Database unavailable");
      },
    }),
    /Database unavailable/,
  );
});

test("concurrent startup tolerates an already-added request-control column", async () => {
  const attempted = [];
  await ensureCredentialRequestControlsSchema({
    async query(sql) {
      if (sql.startsWith("SELECT")) return [[]];
      attempted.push(sql);
      throw Object.assign(new Error("Another process added this column"), {
        code: "ER_DUP_FIELDNAME",
      });
    },
  });
  assert.equal(attempted.length, 2);
});
