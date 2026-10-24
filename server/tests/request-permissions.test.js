import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import { adminRouter } from "../routes/admin.routes.js";
import { requireAdmin } from "../middleware/auth.middleware.js";
import { encryptPassword } from "../services/encryption.service.js";
import { ensureAdminRequestPermissionsSchema } from "../services/admin-request-permissions.service.js";
import {
  REQUEST_PERMISSION_KEYS,
  effectiveRequestPermissions,
  validateRequestPermissions,
} from "../../shared/request-permissions.mjs";

after(() => pool.end());

async function setup(t) {
  const actor = {
    id: 1,
    username: "staff@example.test",
    full_name: "Request Staff",
    is_active: 1,
    role_name: "Request Staff",
    request_permissions: ["EMAIL:PASSWORD_RESET"],
  };
  const rows = [
    {
      id: 1,
      credential_type: "EMAIL",
      request_kind: "PASSWORD_RESET",
      status: "PENDING",
    },
    {
      id: 2,
      credential_type: "EMAIL",
      request_kind: "ACCOUNT_CREATION",
      status: "PENDING",
    },
    {
      id: 3,
      credential_type: "KUMOSOFT",
      request_kind: "PASSWORD_RESET",
      status: "PENDING",
    },
    {
      id: 4,
      credential_type: "VOUCHER",
      request_kind: "VOUCHER_REQUEST",
      status: "PENDING",
    },
    {
      id: 5,
      credential_type: "EMAIL",
      request_kind: "PASSWORD_RESET",
      status: "COMPLETED",
    },
  ].map((row) => ({
    ...row,
    student_id: 7,
    ...encryptPassword(`${row.credential_type}-test-secret`),
  }));
  const writes = [],
    calls = [];
  let rolledBack = 0;
  const roles = [
    { id: 1, name: "Super Admin" },
    { id: 2, name: "Request Staff" },
  ];
  const selectRows = (sql, values) =>
    sql.includes("1=0")
      ? []
      : rows.filter((row) =>
          values.some(
            (value, index) =>
              index % 2 === 0 &&
              row.credential_type === value &&
              row.request_kind === values[index + 1],
          ),
        );
  t.mock.method(pool, "query", async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT COUNT(*) count,"))
      return [
        [
          {
            count: selectRows(sql, values).filter(
              (row) => row.status === "PENDING",
            ).length,
            latestPendingId: String(
              Math.max(
                0,
                ...selectRows(sql, values)
                  .filter((row) => row.status === "PENDING")
                  .map((row) => row.id),
              ),
            ),
          },
        ],
      ];
    if (sql.includes("FROM password_reset_requests pr"))
      return [selectRows(sql, values)];
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.mock.method(pool, "execute", async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT a.id, a.username")) return [[{ ...actor }]];
    if (sql.startsWith("SELECT id FROM roles"))
      return [[roles.find((role) => role.id === values[0])].filter(Boolean)];
    if (sql.startsWith("INSERT INTO audit_logs")) return [{ affectedRows: 1 }];
    if (sql.startsWith("INSERT INTO admin_users")) {
      writes.push({ sql, values });
      return [{ insertId: 3 }];
    }
    if (sql.includes("UPDATE password_reset_requests")) {
      writes.push({ sql, values });
      const row = rows.find(
        (row) =>
          row.id === values[1] &&
          row.status === "PENDING" &&
          row.credential_type === "VOUCHER",
      );
      if (row) row.status = "REJECTED";
      return [{ affectedRows: row ? 1 : 0 }];
    }
    throw new Error(`Unexpected execute: ${sql}`);
  });
  t.mock.method(pool, "getConnection", async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    release() {},
    rollback: async () => {
      rolledBack++;
    },
    execute: async (sql, values) => {
      if (sql.startsWith("SELECT r."))
        return [
          [{ admin_user_id: 1, review_token: "a".repeat(64), is_live: 1 }],
        ];
      if (sql.startsWith("DELETE FROM credential_request_reviews"))
        return [{ affectedRows: 1 }];
      if (sql.startsWith("SELECT student_id, credential_type, request_kind"))
        return [
          [
            rows.find(
              (row) => row.id === values[0] && row.status === "PENDING",
            ),
          ].filter(Boolean),
        ];
      if (sql.startsWith("UPDATE password_reset_requests")) {
        writes.push({ sql, values });
        rows.find((row) => row.id === values[1]).status = sql.includes(
          "REJECTED",
        )
          ? "REJECTED"
          : "COMPLETED";
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("SELECT a.id, a.is_active"))
        return [[{ id: 2, is_active: 1, role_name: "Request Staff" }]];
      if (sql.startsWith("SELECT id, name FROM roles"))
        return [[roles.find((role) => role.id === values[0])].filter(Boolean)];
      if (sql.startsWith("UPDATE admin_users")) {
        writes.push({ sql, values });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  }));
  const app = express();
  app.use(express.json());
  app.get("/me", requireAdmin, (req, res) => res.json(req.admin));
  app.use("/admin", adminRouter);
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ message: error.message }),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  // Deliberately stale role claims: authorization must use the database role.
  const token = jwt.sign(
    { sub: 1, role: "Super Admin" },
    config().accessSecret,
    { expiresIn: "5m" },
  );
  const send = async (path, method = "GET", body) => {
    if (/\/(?:complete|reject)$/.test(path))
      body = { ...body, reviewToken: "a".repeat(64) };
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  return { actor, rows, writes, calls, send, rolledBack: () => rolledBack };
}

test("permission defaults preserve existing Super Admins and deny invalid configurations", () => {
  assert.deepEqual(
    effectiveRequestPermissions(null, "Super Admin"),
    REQUEST_PERMISSION_KEYS,
  );
  assert.deepEqual(effectiveRequestPermissions(null, "Request Staff"), []);
  assert.deepEqual(effectiveRequestPermissions([], "Super Admin"), []);
  assert.deepEqual(
    effectiveRequestPermissions('["EMAIL:PASSWORD_RESET"]', "Super Admin"),
    ["EMAIL:PASSWORD_RESET"],
  );
  for (const invalid of ["*", {}, ["EMAIL:*"], ["VOUCHER:PASSWORD_RESET"], [1]])
    assert.throws(() => validateRequestPermissions(invalid), { status: 400 });
  assert.deepEqual(effectiveRequestPermissions("{broken", "Super Admin"), []);
});

test("request list, resolved entries, credentials, and sidebar count are scoped in SQL", async (t) => {
  const { send, calls } = await setup(t);
  const list = await send(
    "/admin/password-reset-requests?requestPermissions=all",
  );
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.map((row) => row.id),
    [1, 5],
  );
  assert.ok(
    list.body.every((row) => row.default_password === "EMAIL-test-secret"),
  );
  assert.doesNotMatch(JSON.stringify(list.body), /KUMOSOFT-test-secret/);
  const count = await send("/admin/password-reset-requests/pending-count");
  assert.deepEqual(count.body, { count: 1, latestPendingId: "1" });
  assert.ok(
    calls
      .filter(({ sql }) => sql.includes("FROM password_reset_requests pr"))
      .every(({ sql }) =>
        sql.includes("pr.credential_type=? AND pr.request_kind=?"),
      ),
  );
});

test("tab alerts detect new permitted requests even when the pending count is unchanged", async (t) => {
  const { send, rows, calls } = await setup(t);
  rows.push({
    id: 99,
    credential_type: "KUMOSOFT",
    request_kind: "PASSWORD_RESET",
    status: "PENDING",
  });
  const before = await send("/admin/password-reset-requests/pending-count");
  assert.deepEqual(before.body, { count: 1, latestPendingId: "1" });
  rows[0].status = "COMPLETED";
  rows.push({
    id: 6,
    credential_type: "EMAIL",
    request_kind: "PASSWORD_RESET",
    status: "PENDING",
  });
  const after = await send("/admin/password-reset-requests/pending-count");
  assert.deepEqual(after.body, { count: 1, latestPendingId: "6" });
  const counter = calls.find(({ sql }) =>
    sql.startsWith("SELECT COUNT(*) count,"),
  );
  assert.match(counter.sql, /MAX\(pr.id\)/);
  assert.match(counter.sql, /pr.status='PENDING'/);
  assert.deepEqual(counter.values, ["EMAIL", "PASSWORD_RESET"]);
});

test("direct completion attempts cannot cross system or request-kind permissions", async (t) => {
  const { send, writes, rolledBack, rows } = await setup(t);
  for (const id of [2, 3, 4]) {
    const denied = await send(
      `/admin/password-reset-requests/${id}/complete`,
      "PATCH",
      { requestPermissions: REQUEST_PERMISSION_KEYS },
    );
    assert.equal(denied.status, 403);
  }
  assert.equal(writes.length, 0);
  assert.equal(rolledBack(), 3);
  assert.ok(
    rows
      .filter((row) => [2, 3, 4].includes(row.id))
      .every((row) => row.status === "PENDING"),
  );
  const allowed = await send(
    "/admin/password-reset-requests/1/complete",
    "PATCH",
    {},
  );
  assert.equal(allowed.status, 200);
  assert.equal(rows[0].status, "COMPLETED");
});

test("voucher rejection requires voucher permission", async (t) => {
  const { send, actor, rows, writes } = await setup(t);
  assert.equal(
    (await send("/admin/password-reset-requests/4/reject", "PATCH")).status,
    403,
  );
  assert.equal(writes.length, 0);
  actor.request_permissions = ["VOUCHER:VOUCHER_REQUEST"];
  assert.equal(
    (await send("/admin/password-reset-requests/4/reject", "PATCH")).status,
    200,
  );
  assert.equal(rows[3].status, "REJECTED");
});

test("permission revocation and account deactivation affect existing tokens immediately", async (t) => {
  const { actor, send } = await setup(t);
  assert.equal((await send("/admin/password-reset-requests")).body.length, 2);
  actor.request_permissions = [];
  assert.deepEqual((await send("/admin/password-reset-requests")).body, []);
  assert.deepEqual(
    (await send("/admin/password-reset-requests/pending-count")).body,
    { count: 0, latestPendingId: "0" },
  );
  assert.equal(
    (await send("/admin/password-reset-requests/1/complete", "PATCH", {}))
      .status,
    403,
  );
  actor.is_active = 0;
  assert.equal((await send("/me")).status, 401);
});

test("Request Staff cannot use stale Super Admin tokens to manage users or other records", async (t) => {
  const { send, writes } = await setup(t);
  for (const path of [
    "/admin/admin-users",
    "/admin/students",
    "/admin/account-exports",
    "/admin/dashboard",
    "/admin/transactions",
    "/admin/transactions/academic-periods",
    "/admin/transactions/export?academicPeriodId=3",
  ])
    assert.equal((await send(path)).status, 403);
  assert.equal(
    (
      await send("/admin/admin-users/2", "PATCH", {
        requestPermissions: REQUEST_PERMISSION_KEYS,
      })
    ).status,
    403,
  );
  assert.equal(writes.length, 0);
  assert.equal((await send("/me")).body.role, "Request Staff");
});

test("explicit scopes also restrict Super Admin request processing", async (t) => {
  const { actor, send } = await setup(t);
  actor.role_name = "Super Admin";
  assert.deepEqual(
    (await send("/admin/password-reset-requests")).body.map((row) => row.id),
    [1, 5],
  );
  assert.equal(
    (await send("/admin/password-reset-requests/3/complete", "PATCH", {}))
      .status,
    403,
  );
  actor.request_permissions = null;
  assert.equal((await send("/admin/password-reset-requests")).body.length, 5);
});

test("Super Admin saves exact permissions and invalid permissions cannot be persisted", async (t) => {
  const { actor, send, writes } = await setup(t);
  actor.role_name = "Super Admin";
  const body = {
    firstName: "Test",
    lastName: "Staff",
    username: "staff@example.test",
    roleId: 2,
    isActive: true,
    requestPermissions: ["SCHOOLOGY:ACCOUNT_CREATION", "EMAIL:PASSWORD_RESET"],
  };
  assert.equal((await send("/admin/admin-users/2", "PATCH", body)).status, 200);
  assert.deepEqual(JSON.parse(writes.at(-1).values[4]), [
    "EMAIL:PASSWORD_RESET",
    "SCHOOLOGY:ACCOUNT_CREATION",
  ]);
  const writeCount = writes.length;
  assert.equal(
    (
      await send("/admin/admin-users/2", "PATCH", {
        ...body,
        requestPermissions: ["*"],
      })
    ).status,
    400,
  );
  assert.equal(writes.length, writeCount);
  assert.equal(
    (
      await send("/admin/admin-users/2", "PATCH", {
        ...body,
        requestPermissions: [],
      })
    ).status,
    200,
  );
  assert.equal(writes.at(-1).values[4], "[]");
  assert.equal(
    (
      await send("/admin/admin-users", "POST", {
        ...body,
        password: "Test password 12",
      })
    ).status,
    201,
  );
  assert.deepEqual(JSON.parse(writes.at(-1).values[5]), [
    "EMAIL:PASSWORD_RESET",
    "SCHOOLOGY:ACCOUNT_CREATION",
  ]);
});

test("schema setup is additive and safely repeatable", async () => {
  const calls = [];
  let present = false;
  const executor = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.startsWith("SELECT COLUMN_NAME"))
        return [present ? [{ COLUMN_NAME: "request_permissions" }] : []];
      if (sql.startsWith("ALTER TABLE")) {
        present = true;
        return [{}];
      }
      throw new Error(sql);
    },
    execute: async (sql, values) => {
      calls.push(sql);
      assert.equal(values[0], "Request Staff");
      return [{}];
    },
  };
  await ensureAdminRequestPermissionsSchema(executor);
  await ensureAdminRequestPermissionsSchema(executor);
  assert.equal(calls.filter((sql) => sql.startsWith("ALTER TABLE")).length, 1);
});
