import assert from "node:assert/strict";
import { after, test } from "node:test";
import ExcelJS from "exceljs";
import express from "express";
import { pool } from "../config/db.js";
import {
  exportTransactions,
  listTransactions,
  transactionAcademicPeriods,
} from "../controllers/admin.controller.js";

after(() => pool.end());

async function setup(t, { count = 1031, noCurrent = false } = {}) {
  const periods = [
    {
      id: 8,
      school_year: "2026-2027",
      semester: "First semester",
      is_current: 1,
      is_active: 1,
    },
    {
      id: 3,
      school_year: "2025-2026",
      semester: "Second semester",
      is_current: 0,
      is_active: 0,
    },
  ];
  const rows = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    student_id: "0012345",
    first_name: "Test",
    middle_name: null,
    last_name: "Student",
    kiosk_code: "KIOSK-01",
    success: 1,
    created_at: new Date("2026-10-22T02:59:40.000Z"),
  }));
  const calls = [];
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes("FROM academic_periods")) {
      if (sql.includes("WHERE id=?"))
        return [periods.filter((period) => period.id === values[0])];
      if (sql.includes("WHERE is_current=1"))
        return [noCurrent ? [] : [periods[0]]];
      return [
        periods.map((period) => ({
          id: period.id,
          schoolYear: period.school_year,
          semester: period.semester,
          isCurrent: period.is_current && period.is_active,
        })),
      ];
    }
    if (sql.includes("COUNT(*) AS total"))
      return [
        [{ total: rows.length, today: 0, studentsServed: rows.length ? 1 : 0 }],
      ];
    if (sql.includes("FROM credential_transactions t")) {
      if (sql.includes("LIMIT ? OFFSET ?"))
        return [rows.slice(values[2], values[2] + values[1])];
      if (sql.includes("LIMIT 1000")) return [rows.slice(0, 1000)];
      return [rows];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "execute", query);
  const app = express();
  app.get("/transactions", listTransactions);
  app.get("/transactions/academic-periods", transactionAcademicPeriods);
  app.get("/transactions/export", exportTransactions);
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
  const get = (path) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`);
  return { calls, rows, get };
}

test("Excel export includes all historical transactions, independent of pagination", async (t) => {
  const { get, calls, rows } = await setup(t);
  const response = await get(
    "/transactions/export?academicPeriodId=3&page=2&limit=10",
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /spreadsheetml.sheet/);
  assert.match(
    response.headers.get("content-disposition"),
    /transactions-2025-2026-Second-semester-3.xlsx/,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, rows.length + 1);
  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    "Transaction ID",
    "School year",
    "Semester",
    "Student ID",
    "Student name",
    "Kiosk",
    "Result",
    "Date and time (UTC+08:00)",
  ]);
  assert.deepEqual(sheet.getRow(2).values.slice(1), [
    1,
    "2025-2026",
    "Second semester",
    "0012345",
    "Test Student",
    "KIOSK-01",
    "Revealed",
    "2026-10-22 10:59:40",
  ]);
  assert.equal(sheet.getRow(rows.length + 1).getCell(1).value, rows.length);
  const exported = calls.find(({ sql }) =>
    sql.includes("FROM credential_transactions t"),
  );
  assert.deepEqual(exported.values, [3]);
  assert.match(exported.sql, /t.academic_period_id=\?/);
  assert.match(
    exported.sql,
    /t.transaction_type='VIEW_CREDENTIALS' AND t.success=1/,
  );
  assert.match(exported.sql, /ORDER BY t.created_at DESC, t.id DESC/);
  assert.doesNotMatch(exported.sql, /LIMIT|s.academic_period_id|password/i);
});

test("period options include inactive historical periods without changing the active period", async (t) => {
  const { get, calls } = await setup(t);
  const response = await get("/transactions/academic-periods");
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).map(({ id, isCurrent }) => ({ id, isCurrent })),
    [
      { id: 8, isCurrent: 1 },
      { id: 3, isCurrent: 0 },
    ],
  );
  assert.ok(calls.every(({ sql }) => sql.startsWith("SELECT")));
});

test("historical table pagination and summaries use the selected transaction period", async (t) => {
  const { get, calls } = await setup(t);
  const response = await get(
    "/transactions?academicPeriodId=3&page=2&limit=10",
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.total, 1031);
  assert.equal(body.page, 2);
  assert.equal(body.rows[0].id, 11);
  const summary = calls.find(({ sql }) => sql.includes("COUNT(*) AS total"));
  const listing = calls.find(({ sql }) => sql.includes("LIMIT ? OFFSET ?"));
  assert.deepEqual(summary.values, [3]);
  assert.deepEqual(listing.values, [3, 10, 10]);
  assert.match(summary.sql, /t.academic_period_id=\?/);
  assert.doesNotMatch(listing.sql, /s.academic_period_id/);
});

test("export defaults to current period and retains headers for an empty period", async (t) => {
  const { get, calls } = await setup(t, { count: 0 });
  const response = await get("/transactions/export");
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition"),
    /2026-2027-First-semester-8.xlsx/,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.worksheets[0].rowCount, 1);
  assert.equal(workbook.worksheets[0].columnCount, 8);
  assert.deepEqual(calls.at(-1).values, [8]);
});

test("old transaction clients retain their capped array response in the current period", async (t) => {
  const { get, calls } = await setup(t);
  const response = await get("/transactions");
  const body = await response.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 1000);
  assert.deepEqual(calls.at(-1).values, [8]);
});

test("invalid or unknown period selections fail before querying transactions", async (t) => {
  const { get, calls } = await setup(t);
  for (const path of ["/transactions/export", "/transactions?page=1&"]) {
    for (const value of [
      "",
      "0",
      "-1",
      "1.5",
      "1e0",
      "9007199254740992",
      "3%20OR%201=1",
      "3&academicPeriodId=8",
    ]) {
      const response = await get(
        `${path}${path.includes("?") ? "" : "?"}academicPeriodId=${value}`,
      );
      assert.equal(response.status, 400, `${path}: ${value}`);
    }
    const response = await get(
      `${path}${path.includes("?") ? "" : "?"}academicPeriodId=99`,
    );
    assert.equal(response.status, 404);
  }
  assert.ok(
    calls.every(({ sql }) => !sql.includes("FROM credential_transactions")),
  );
});

test("a missing current period does not prevent exporting a previous period", async (t) => {
  const { get } = await setup(t, { noCurrent: true, count: 0 });
  assert.equal((await get("/transactions/export")).status, 404);
  assert.equal(
    (await get("/transactions/export?academicPeriodId=3")).status,
    200,
  );
});
