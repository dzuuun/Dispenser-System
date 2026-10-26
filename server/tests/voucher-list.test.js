import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { listVouchers } from "../controllers/voucher-admin.controller.js";

after(() => pool.end());

async function list(t, query) {
  const calls = [];
  const summary = { total: 4769, available: 1106, assigned: 3663 };
  const rows = [{ id: 42, voucher_code: "TEST-42" }];
  const run = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("FROM academic_periods")) return [[{ id: 7 }]];
    if (sql.startsWith("SELECT COUNT(*) AS total")) return [[summary]];
    if (sql.startsWith("SELECT COUNT(*) AS count")) return [[{ count: 31 }]];
    if (sql.startsWith("SELECT w.id")) return [rows];
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(pool, "execute", run);
  t.mock.method(pool, "query", run);
  const res = {
    json(body) {
      this.body = body;
    },
  };
  await listVouchers({ query: { draw: "1", length: "25", ...query } }, res);
  return { calls, body: res.body, rows, summary };
}

for (const [status, active] of [
  ["active", 1],
  ["inactive", 0],
]) {
  test(`${status} voucher filter applies before pagination and counts`, async (t) => {
    const { calls, body, summary } = await list(t, { status, start: "25" });
    const count = calls.find(({ sql }) =>
      sql.startsWith("SELECT COUNT(*) AS count"),
    );
    const rows = calls.find(({ sql }) => sql.startsWith("SELECT w.id"));
    assert.match(count.sql, /WHERE w.academic_period_id=\? AND w.is_active=\?/);
    assert.doesNotMatch(count.sql, /JOIN students/);
    assert.deepEqual(count.values, [7, active]);
    assert.match(rows.sql, /WHERE w.academic_period_id=\? AND w.is_active=\?/);
    assert.deepEqual(rows.values, [7, active, 25, 25]);
    assert.equal(body.recordsFiltered, 31);
    assert.equal(body.recordsTotal, 4769);
    assert.deepEqual(body.summary, summary);
  });
}

test("voucher status filter combines with student search using bound values", async (t) => {
  const { calls } = await list(t, {
    status: "active",
    "search[value]": "Demo",
  });
  const count = calls.find(({ sql }) =>
    sql.startsWith("SELECT COUNT(*) AS count"),
  );
  const rows = calls.find(({ sql }) => sql.startsWith("SELECT w.id"));
  assert.match(count.sql, /LEFT JOIN students/);
  assert.match(count.sql, /w.is_active=\?/);
  assert.deepEqual(count.values, [7, 1, ...Array(12).fill("%Demo%")]);
  assert.deepEqual(rows.values, [...count.values, 25, 0]);
});

test("voucher search includes every displayed data column and binds literal wildcard characters", async (t) => {
  const { calls } = await list(t, { "search[value]": " Available_100%! " });
  const count = calls.find(({ sql }) =>
    sql.startsWith("SELECT COUNT(*) AS count"),
  );
  const rows = calls.find(({ sql }) => sql.startsWith("SELECT w.id"));
  for (const { sql } of [count, rows]) {
    assert.match(sql, /w\.voucher_code LIKE \? ESCAPE '!'/);
    assert.match(sql, /s\.student_id LIKE \? ESCAPE '!'/);
    assert.match(sql, /NULLIF\(NULLIF\(TRIM\(s\.middle_name\), '-'\), ''\)/);
    assert.match(sql, /THEN 'Not assigned'/);
    assert.match(
      sql,
      /THEN 'Inactive'.*THEN 'Assigned'.*THEN 'Released' ELSE 'Available'/,
    );
    assert.match(
      sql,
      /DATE_FORMAT\(w\.assigned_at, '%c\/%e\/%Y, %l:%i:%s %p'\)/,
    );
    assert.ok(!sql.includes("Available_100%!"));
  }
  assert.deepEqual(count.values, [
    7,
    ...Array(12).fill("%Available!_100!%!!%"),
  ]);
  assert.deepEqual(rows.values, [...count.values, 25, 0]);
});

for (const status of [undefined, "all", "unknown"]) {
  test(`unfiltered voucher status ${status} keeps the summary count shortcut`, async (t) => {
    const { calls, body } = await list(t, { status });
    assert.equal(
      calls.some(({ sql }) => sql.startsWith("SELECT COUNT(*) AS count")),
      false,
    );
    const rows = calls.find(({ sql }) => sql.startsWith("SELECT w.id"));
    assert.doesNotMatch(rows.sql, /w.is_active=\?/);
    assert.deepEqual(rows.values, [7, 25, 0]);
    assert.equal(body.recordsFiltered, 4769);
  });
}
