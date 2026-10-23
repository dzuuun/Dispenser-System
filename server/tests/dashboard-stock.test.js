import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { dashboard } from "../controllers/admin.controller.js";

after(() => pool.end());

async function loadDashboard(t, {
  period = { id: 7, school_year: "2026-2027", semester: "First semester" },
  students = { total: 356, withoutVoucher: "120" },
  vouchers = { available: "90", assigned: "400" },
} = {}) {
  const calls = [];
  const run = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes("FROM academic_periods")) return [period ? [period] : []];
    if (sql.includes("FROM students WHERE")) return [[students]];
    if (sql.includes("FROM wifi_vouchers WHERE")) return [[vouchers]];
    if (sql.includes("FROM credential_transactions")) return [[]];
    if (sql.includes("FROM kiosks")) return [[{ total: 1, online: 1 }]];
    if (sql.includes("FROM satp_accounts")) return [[]];
    if (sql.includes("FROM password_reset_requests")) return [[{ total: 0 }]];
    if (sql.includes("FROM courses")) return [[{ total: 3 }]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(pool, "query", run);
  t.mock.method(pool, "execute", run);
  let body;
  await dashboard({ admin: { requestPermissions: [] } }, { json: (data) => { body = data; } });
  return { body, calls };
}

test("dashboard counts students without a voucher directly instead of subtracting assigned stock", async (t) => {
  // Assigned stock can include holders outside the current active student cohort.
  const { body, calls } = await loadDashboard(t);
  assert.equal(body.activeStudents, 356);
  assert.equal(body.vouchers.studentsWithoutVoucher, 120);
  assert.equal(body.vouchers.available, 90);
  assert.equal(body.vouchers.assigned, 400);
  const studentQuery = calls.find(({ sql }) => sql.includes("FROM students WHERE"));
  assert.match(studentQuery.sql, /COALESCE\(SUM\(voucher_id IS NULL\), 0\) withoutVoucher/);
  assert.match(studentQuery.sql, /WHERE is_active=1 AND academic_period_id=\?/);
  assert.deepEqual(studentQuery.values, [7]);
  const stockQuery = calls.find(({ sql }) => sql.includes("FROM wifi_vouchers WHERE"));
  assert.match(stockQuery.sql, /is_active=1 AND is_assigned=0 AND is_released=0/);
  assert.deepEqual(stockQuery.values, [7]);
});

test("dashboard reports zero students waiting when everyone has an assigned voucher", async (t) => {
  const { body } = await loadDashboard(t, {
    students: { total: 200, withoutVoucher: 0 },
    vouchers: { available: 50, assigned: 200 },
  });
  assert.equal(body.vouchers.studentsWithoutVoucher, 0);
  assert.equal(body.vouchers.available, 50);
});

test("empty stock is returned as zero for comparison with students needing vouchers", async (t) => {
  const { body } = await loadDashboard(t, {
    students: { total: 200, withoutVoucher: 200 },
    vouchers: { available: null, assigned: null },
  });
  assert.equal(body.vouchers.studentsWithoutVoucher, 200);
  assert.equal(body.vouchers.available, 0);
  assert.equal(body.vouchers.total, 0);
});

test("a missing current period cannot include students or vouchers from historical periods", async (t) => {
  const { body, calls } = await loadDashboard(t, {
    period: null,
    students: { total: 0, withoutVoucher: null },
    vouchers: { available: null, assigned: null },
  });
  assert.equal(body.academicPeriod, null);
  assert.equal(body.vouchers.studentsWithoutVoucher, 0);
  assert.equal(body.vouchers.available, 0);
  const scoped = calls.filter(({ sql }) => sql.includes("FROM students WHERE") || sql.includes("FROM wifi_vouchers WHERE"));
  assert.ok(scoped.every(({ values }) => values[0] === 0));
});
