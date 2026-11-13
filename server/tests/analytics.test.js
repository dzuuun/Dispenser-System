import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { analytics } from "../controllers/analytics.controller.js";

after(() => pool.end());

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } };
}

test("analytics scopes activity to the current period and applies request permissions", async (t) => {
  const calls = [];
  t.mock.method(pool, "query", async (sql) => sql.includes("CURDATE") ? [[{ today: "2026-11-13" }]] : sql.includes("FROM kiosks") ? [[{ kiosk_code: "K1", kiosk_name: "Kiosk 1", location: "Library" }]] : [[{ id: 4, school_year: "2026-2027", semester: "First semester" }]]);
  t.mock.method(pool, "execute", async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("FROM students WHERE")) return [[{ total: 15, with_voucher: 8 }]];
    if (sql.includes("JOIN courses")) return [[{ code: "BSIT", name: "Information Technology", total: 15 }]];
    if (sql.includes("DATE_FORMAT(t.created_at") && sql.includes("LEFT JOIN kiosks")) return [[{ day: "2026-11-13", kiosk_code: "K1", kiosk_name: "Kiosk 1", location: "Library", total: 4, students: 3 }]];
    if (sql.includes("DATE_FORMAT(t.created_at")) return [[{ day: "2026-11-13", total: 4, students: 3 }]];
    if (sql.includes("LEFT JOIN kiosks")) return [[{ location: "Library", total: 4 }]];
    if (sql.includes("FROM password_reset_requests")) return [[{ credential_type: "EMAIL", status: "PENDING", total: 2 }]];
    throw new Error(sql);
  });
  const res = response();
  await analytics({ query: { days: "7" }, admin: { requestPermissions: ["EMAIL:PASSWORD_RESET"] } }, res);
  assert.equal(res.body.academicPeriod.id, 4);
  assert.equal(res.body.students.with_voucher, 8);
  assert.equal(res.body.activity[0].total, 4);
  assert.equal(res.body.today, "2026-11-13");
  assert.equal(res.body.dailyKiosks[0].kiosk_code, "K1");
  assert.deepEqual(calls.find((call) => call.sql.includes("DATE_FORMAT(t.created_at") && call.sql.includes("LEFT JOIN kiosks")).values, [4, 6]);
  assert.deepEqual(calls.find((call) => call.sql.includes("DATE_FORMAT(t.created_at")).values, [4, 6]);
  assert.deepEqual(calls.find((call) => call.sql.includes("FROM password_reset_requests")).values, [6, "EMAIL", "PASSWORD_RESET"]);
  assert.ok(calls.find((call) => call.sql.includes("FROM password_reset_requests")).sql.includes("pr.credential_type=? AND pr.request_kind=?"));
});

test("analytics rejects invalid windows without querying the database", async (t) => {
  t.mock.method(pool, "query", async () => assert.fail("unexpected query"));
  const res = response();
  await analytics({ query: { days: "31" }, admin: {} }, res);
  assert.equal(res.statusCode, 400);
});

test("analytics with no period or request permissions does not expose request categories", async (t) => {
  const calls = [];
  t.mock.method(pool, "query", async (sql) => sql.includes("CURDATE") ? [[{ today: "2026-11-13" }]] : [[]]);
  t.mock.method(pool, "execute", async (sql, values) => {
    calls.push({ sql, values });
    return sql.includes("FROM students WHERE") ? [[{ total: 0, with_voucher: 0 }]] : [[]];
  });
  const res = response();
  await analytics({ query: {}, admin: { requestPermissions: [] } }, res);
  assert.equal(res.body.academicPeriod, null);
  assert.equal(res.body.days, 30);
  const requests = calls.find((call) => call.sql.includes("FROM password_reset_requests"));
  assert.match(requests.sql, /AND 1=0/);
  assert.deepEqual(requests.values, [29]);
  assert.deepEqual(calls.find((call) => call.sql.includes("DATE_FORMAT(t.created_at")).values, [0, 29]);
});
