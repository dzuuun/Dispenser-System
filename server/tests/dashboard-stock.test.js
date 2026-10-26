import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { dashboard } from "../controllers/admin.controller.js";

after(() => pool.end());

async function loadDashboard(
  t,
  {
    period = { id: 7, school_year: "2026-2027", semester: "First semester" },
    students = { total: 356, withoutVoucher: "120" },
    vouchers = { available: "90", assigned: "400" },
    recentActivity = [],
    recentRequests = [],
    devices = [{ id: 1, is_online: 1, activity_state: "IDLE", activity_is_fresh: 1 }],
    permissions = [],
  } = {},
) {
  const calls = [];
  const run = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes("FROM academic_periods")) return [period ? [period] : []];
    if (sql.includes("FROM students WHERE")) return [[students]];
    if (sql.includes("FROM wifi_vouchers WHERE")) return [[vouchers]];
    if (sql.includes("FROM credential_transactions")) return [recentActivity];
    if (sql.includes("FROM kiosks")) return [devices];
    if (sql.includes("FROM satp_accounts")) return [[]];
    if (sql.includes("FROM password_reset_requests"))
      return sql.includes("COUNT(*)") ? [[{ total: 0 }]]
        : [recentRequests.filter((item) => item.status === "PENDING")];
    if (sql.includes("FROM courses")) return [[{ total: 3 }]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(pool, "query", run);
  t.mock.method(pool, "execute", run);
  let body;
  const headers = {};
  await dashboard(
    { admin: { requestPermissions: permissions } },
    {
      set(name, value) {
        headers[name] = value;
        return this;
      },
      json: (data) => {
        body = data;
      },
    },
  );
  return { body, calls, headers };
}

test("dashboard returns populated reveal rows as an array instead of discarding the first row", async (t) => {
  const recentActivity = [
    {
      id: 8,
      transaction_type: "VIEW_CREDENTIALS",
      first_name: "New",
      middle_name: "Test",
      last_name: "Student",
      student_id: "2026008",
      kiosk_code: "KIOSK-01",
      kiosk_location: "ICT/MIS Office",
      created_at: "2026-10-24T08:00:00.000Z",
    },
    {
      id: 7,
      transaction_type: "VIEW_CREDENTIALS",
      first_name: "Earlier",
      last_name: "Student",
      student_id: "2026007",
      kiosk_code: "KIOSK-02",
      kiosk_location: "Library",
      created_at: "2026-10-24T07:00:00.000Z",
    },
  ];
  const { body, calls, headers } = await loadDashboard(t, { recentActivity });
  assert.deepEqual(body.recentActivity, recentActivity);
  assert.equal(headers["Cache-Control"], "no-store");
  const query = calls.find(({ sql }) =>
    sql.includes("FROM credential_transactions"),
  );
  assert.deepEqual(query.values, [7]);
  assert.match(query.sql, /SELECT t\.id,/);
  assert.match(query.sql, /LEFT JOIN kiosks k ON k\.kiosk_code=t\.kiosk_code/);
  assert.match(query.sql, /COALESCE\(NULLIF\(TRIM\(k\.location\), ''\), 'Unassigned'\) AS kiosk_location/);
  assert.match(
    query.sql,
    /t\.academic_period_id=\? AND t\.transaction_type='VIEW_CREDENTIALS' AND t\.success=1/,
  );
  assert.match(query.sql, /ORDER BY t\.created_at DESC, t\.id DESC LIMIT 5/);
});

test("a single reveal also remains a one-item array", async (t) => {
  const recentActivity = [
    {
      transaction_type: "VIEW_CREDENTIALS",
      student_id: "2026001",
      created_at: "2026-10-24T08:00:00.000Z",
    },
  ];
  const { body } = await loadDashboard(t, { recentActivity });
  assert.deepEqual(body.recentActivity, recentActivity);
});

test("a dashboard with no reveals returns an empty activity array", async (t) => {
  const { body } = await loadDashboard(t);
  assert.deepEqual(body.recentActivity, []);
});

test("dashboard counts students without a voucher directly instead of subtracting assigned stock", async (t) => {
  // Assigned stock can include holders outside the current active student cohort.
  const { body, calls } = await loadDashboard(t);
  assert.equal(body.activeStudents, 356);
  assert.equal(body.vouchers.studentsWithoutVoucher, 120);
  assert.equal(body.vouchers.available, 90);
  assert.equal(body.vouchers.assigned, 400);
  const studentQuery = calls.find(({ sql }) =>
    sql.includes("FROM students WHERE"),
  );
  assert.match(
    studentQuery.sql,
    /COALESCE\(SUM\(voucher_id IS NULL\), 0\) withoutVoucher/,
  );
  assert.match(studentQuery.sql, /WHERE is_active=1 AND academic_period_id=\?/);
  assert.deepEqual(studentQuery.values, [7]);
  const stockQuery = calls.find(({ sql }) =>
    sql.includes("FROM wifi_vouchers WHERE"),
  );
  assert.match(
    stockQuery.sql,
    /is_active=1 AND is_assigned=0 AND is_released=0/,
  );
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
  const scoped = calls.filter(
    ({ sql }) =>
      sql.includes("FROM students WHERE") ||
      sql.includes("FROM wifi_vouchers WHERE"),
  );
  assert.ok(scoped.every(({ values }) => values[0] === 0));
});

test("dashboard pending requests are limited to the latest five with stable ordering and no credential secrets", async (t) => {
  const recentRequests = Array.from({ length: 6 }, (_, index) => ({
    id: 20 - index,
    credential_type: "SCHOOLOGY",
    request_kind: "PASSWORD_RESET",
    status: "PENDING",
    school_id: `TEST-${index}`,
    first_name: "Test",
    last_name: "Student",
    requested_at: "2026-10-26T08:00:00+08:00",
  }));
  const { body, calls } = await loadDashboard(t, {
    recentRequests,
    permissions: ["SCHOOLOGY:PASSWORD_RESET"],
  });
  assert.deepEqual(body.recentRequests, recentRequests.slice(0, 5));
  const query = calls.find(({ sql }) => sql.includes("SELECT pr.id"));
  assert.match(query.sql, /ORDER BY pr\.requested_at DESC, pr\.id DESC LIMIT 5/);
  assert.match(query.sql, /s\.student_id school_id/);
  assert.match(query.sql, /pr\.status/);
  assert.doesNotMatch(query.sql, /encrypted_password|password_iv|password_auth_tag|default_password|SELECT \*/);
  assert.match(query.sql, /WHERE pr\.status='PENDING' AND \(\(pr\.credential_type=\? AND pr\.request_kind=\?\)\)/);
  assert.deepEqual(query.values, ["SCHOOLOGY", "PASSWORD_RESET"]);
});

test("resolved and rejected requests are excluded from the dashboard pending preview", async (t) => {
  const recentRequests = [
    { id: 4, status: "COMPLETED" },
    { id: 3, status: "PENDING" },
    { id: 2, status: "REJECTED" },
    { id: 1, status: "PENDING" },
  ];
  const { body, calls } = await loadDashboard(t, {
    recentRequests,
    permissions: ["SCHOOLOGY:PASSWORD_RESET"],
  });
  assert.deepEqual(body.recentRequests.map((item) => item.id), [3, 1]);
  const query = calls.find(({ sql }) => sql.includes("SELECT pr.id"));
  assert.match(query.sql, /WHERE pr\.status='PENDING' AND/);
  assert.ok(query.sql.indexOf("pr.status='PENDING'") < query.sql.indexOf("LIMIT 5"));
});

test("dashboard counts and request previews use the same administrator permissions", async (t) => {
  const permissions = ["EMAIL:PASSWORD_RESET", "KUMOSOFT:ACCOUNT_CREATION"];
  const { calls } = await loadDashboard(t, { permissions });
  const requests = calls.filter(({ sql }) => sql.includes("FROM password_reset_requests"));
  assert.equal(requests.length, 2);
  for (const query of requests) {
    assert.match(query.sql, /\(pr\.credential_type=\? AND pr\.request_kind=\?\) OR/);
    assert.deepEqual(query.values, ["EMAIL", "PASSWORD_RESET", "KUMOSOFT", "ACCOUNT_CREATION"]);
  }
});

test("administrators without request permissions receive an empty request preview", async (t) => {
  const { body, calls } = await loadDashboard(t);
  assert.deepEqual(body.recentRequests, []);
  for (const query of calls.filter(({ sql }) => sql.includes("FROM password_reset_requests"))) {
    assert.match(query.sql, /WHERE (?:pr\.status='PENDING' AND )?1=0/);
    assert.deepEqual(query.values, []);
  }
});

test("dashboard kiosk usage shares live activity rules and prioritizes in-use devices", async (t) => {
  const base = { is_online: 1, activity_is_fresh: 1, has_recent_interaction: 1 };
  const devices = [
    { ...base, id: 1, activity_state: "IDLE" },
    { ...base, id: 2, activity_state: "ENTERING_DETAILS" },
    { ...base, id: 3, activity_state: "VIEWING_CREDENTIALS" },
    { ...base, id: 4, activity_state: "VIEWING_CREDENTIALS", has_recent_interaction: 0 },
    { ...base, id: 5, activity_state: "VIEWING_CREDENTIALS", activity_is_fresh: 0 },
    { ...base, id: 6, activity_state: "VIEWING_CREDENTIALS", is_online: 0 },
    { ...base, id: 7, activity_state: "IDLE" },
  ];
  const { body, calls } = await loadDashboard(t, { devices });
  assert.equal(body.kiosks.total, 7);
  assert.equal(body.kiosks.online, 6);
  assert.equal(body.kiosks.inUse, 2);
  assert.equal(body.kiosks.idle, 3);
  assert.equal(body.kiosks.rows.length, 5);
  assert.deepEqual(body.kiosks.rows.map((row) => row.id), [2, 3, 1, 4, 7]);
  assert.deepEqual(body.kiosks.rows.map((row) => row.usage_status), ["IN_USE", "IN_USE", "IDLE", "IDLE", "IDLE"]);
  assert.ok(body.kiosks.rows.every((row) => !("activity_is_fresh" in row) && !("has_recent_interaction" in row)));
  const query = calls.find(({ sql }) => sql.includes("FROM kiosks"));
  assert.match(query.sql, /WHERE is_active=1/);
  assert.match(query.sql, /INTERVAL 5 MINUTE/);
  assert.match(query.sql, /INTERVAL 20 SECOND/);
  assert.match(query.sql, /INTERVAL 30 SECOND/);
});

test("offline and stale kiosk reports do not claim a student is currently using the kiosk", async (t) => {
  const { body } = await loadDashboard(t, { devices: [
    { id: 1, is_online: 0, activity_state: "VIEWING_CREDENTIALS", activity_is_fresh: 1, has_recent_interaction: 1 },
    { id: 2, is_online: 1, activity_state: "VIEWING_CREDENTIALS", activity_is_fresh: 0, has_recent_interaction: 1 },
  ] });
  assert.equal(body.kiosks.inUse, 0);
  assert.deepEqual(body.kiosks.rows.map((row) => row.usage_status), ["UNKNOWN", "OFFLINE"]);
});

test("dashboard supports an empty kiosk inventory without inventing an online or idle device", async (t) => {
  const { body } = await loadDashboard(t, { devices: [] });
  assert.deepEqual(body.kiosks, { total: 0, online: 0, inUse: 0, idle: 0, rows: [] });
});
