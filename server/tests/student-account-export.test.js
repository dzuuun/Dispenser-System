import assert from "node:assert/strict";
import { after, test } from "node:test";
import ExcelJS from "exceljs";
import express from "express";
import { pool } from "../config/db.js";
import {
  exportStudentAccounts,
  listStudents,
} from "../controllers/student-admin.controller.js";
import { encryptPassword } from "../services/encryption.service.js";

after(() => pool.end());

async function setup(
  t,
  { count = 1031, noCurrent = false, fail = false } = {},
) {
  const rows = Array.from({ length: count }, (_, index) => {
    const row = {
      id: index + 1,
      student_id: `00${index + 123}`,
      kumosoft_id: index ? null : "K-0001",
      first_name: index === 1 ? "=SUM(1,2)" : "Test",
      middle_name: null,
      last_name: index === 1 ? "" : "Student",
      is_active: index % 2 ? 0 : 1,
      course_code: "BSIT",
      course_name: "Information Technology",
      email_address: index ? null : "student@example.edu",
    };
    for (const [alias, password] of Object.entries(
      index
        ? {}
        : {
            email_account: "Email password",
            kumosoft_account: "Kumosoft password",
            satp_account: "SATP password",
          },
    ))
      Object.assign(
        row,
        Object.fromEntries(
          Object.entries(encryptPassword(password)).map(([key, value]) => [
            `${alias}_${key}`,
            value,
          ]),
        ),
      );
    return row;
  });
  const calls = [];
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.trimStart().startsWith("SELECT id, school_year, semester"))
      return [
        noCurrent
          ? []
          : [{ id: 7, school_year: "2026-2027", semester: "First semester" }],
      ];
    if (fail) throw new Error("Test export failure");
    if (sql.startsWith("SELECT COUNT(*)"))
      return [[{ total: rows.length, active_total: 1 }]];
    if (sql.startsWith("SELECT s.id"))
      return [
        sql.includes("LIMIT ? OFFSET ?")
          ? rows.slice(values.at(-1), values.at(-1) + values.at(-2))
          : rows,
      ];
    throw new Error(sql);
  };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "execute", query);
  const app = express();
  app.get("/students/export", exportStudentAccounts);
  app.get("/students", listStudents);
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
  const get = (route) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`);
  return { rows, calls, get };
}

const headers = [
  "School ID",
  "Kumosoft ID",
  "Student name",
  "Course code",
  "Course name",
  "Student status",
  "Email",
  "Email password",
  "Kumosoft password",
  "Schoology password",
  "SATP password",
];

test("student workbook names omit dash middle names and preserve real hyphenated names", async (t) => {
  const { rows, get } = await setup(t, { count: 3 });
  for (const [index, middle] of ["-", " - ", "De-la-Pena"].entries()) {
    rows[index].first_name = "Ana-Maria";
    rows[index].middle_name = middle;
    rows[index].last_name = "Santos-Cruz";
  }
  const response = await get("/students/export");
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = workbook.worksheets[0];
  assert.deepEqual(
    [2, 3, 4].map((row) => sheet.getRow(row).getCell(3).text),
    [
      "Ana-Maria Santos-Cruz",
      "Ana-Maria Santos-Cruz",
      "Ana-Maria De-la-Pena Santos-Cruz",
    ],
  );
  assert.equal(rows[0].middle_name, "-");
});

test("student workbook exports email addresses and other account links while preserving IDs as text", async (t) => {
  const { rows, calls, get } = await setup(t);
  const response = await get("/students/export?page=2&limit=10");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /spreadsheetml.sheet/);
  assert.match(
    response.headers.get("content-disposition"),
    /students-linked-accounts-2026-2027-First-semester-7.xlsx/,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = workbook.getWorksheet("Student linked accounts");
  assert.equal(sheet.rowCount, rows.length + 1);
  assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
  assert.deepEqual(sheet.getRow(2).values.slice(1), [
    "00123",
    "K-0001",
    "Test Student",
    "BSIT",
    "Information Technology",
    "Active",
    "student@example.edu",
    "Email password",
    "Kumosoft password",
    "",
    "SATP password",
  ]);
  assert.equal(sheet.getRow(2).getCell(1).type, ExcelJS.ValueType.String);
  assert.deepEqual(sheet.getRow(3).values.slice(1), [
    "00124",
    "",
    "=SUM(1,2)",
    "BSIT",
    "Information Technology",
    "Inactive",
    "",
    "",
    "",
    "",
    "",
  ]);
  assert.equal(sheet.getRow(3).getCell(3).type, ExcelJS.ValueType.String);
  assert.equal(
    sheet.getRow(rows.length + 1).getCell(1).text,
    rows.at(-1).student_id,
  );
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(sheet.autoFilter, "A1:K1");
  const exported = calls.find(({ sql }) => sql.startsWith("SELECT s.id"));
  assert.deepEqual(exported.values, []);
  assert.match(exported.sql, /email_account\.email_address AS email_address/);
  assert.match(
    exported.sql,
    /email_account\.encrypted_password AS email_account_encrypted_password/,
  );
  assert.doesNotMatch(exported.sql, /LIMIT \? OFFSET \?|birth_date/i);
});

test("Email export retains inactive account addresses and their passwords", async (t) => {
  const { rows, get } = await setup(t, { count: 3 });
  rows[1].email_address = "inactive@example.edu";
  Object.assign(
    rows[1],
    Object.fromEntries(
      Object.entries(encryptPassword("Inactive email password")).map(
        ([key, value]) => [`email_account_${key}`, value],
      ),
    ),
  );
  const response = await get("/students/export");
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = workbook.worksheets[0];
  assert.deepEqual(
    [2, 3, 4].map((row) => sheet.getRow(row).getCell(7).text),
    ["student@example.edu", "inactive@example.edu", ""],
  );
  assert.deepEqual(
    [2, 3, 4].map((row) => sheet.getRow(row).getCell(8).text),
    ["Email password", "Inactive email password", ""],
  );
  assert.ok(sheet.getColumn(7).width >= 30);
});

test("export and table share search, missing account, status, academic period and sort filters", async (t) => {
  const { calls, get } = await setup(t, { count: 2 });
  const query =
    "search=BSIT&status=inactive&missingAccount=EMAIL&sort=course&direction=desc";
  assert.equal((await get(`/students?${query}&page=2&limit=10`)).status, 200);
  assert.equal((await get(`/students/export?${query}`)).status, 200);
  const [listing, exported] = calls.filter(({ sql }) =>
    sql.startsWith("SELECT s.id"),
  );
  assert.equal(
    listing.sql
      .slice(listing.sql.indexOf("FROM students"))
      .replace(" LIMIT ? OFFSET ?", ""),
    exported.sql.slice(exported.sql.indexOf("FROM students")),
  );
  assert.deepEqual(listing.values.slice(0, -2), exported.values);
  assert.deepEqual(exported.values, [...Array(11).fill("%BSIT%")]);
  assert.match(exported.sql, /AND NOT \(s\.is_active=1 AND COALESCE/);
  assert.match(
    exported.sql,
    /NOT EXISTS \(SELECT 1 FROM institutional_email_accounts/,
  );
  assert.match(
    exported.sql,
    /ORDER BY c\.code, s\.last_name, s\.first_name DESC$/,
  );
});

test("empty student export retains column headings and worksheet filters", async (t) => {
  const { get } = await setup(t, { count: 0 });
  const response = await get("/students/export?missingAccount=NONE");
  assert.equal(response.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, 1);
  assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
});

test("invalid export filters fail before querying the database", async (t) => {
  const { calls, get } = await setup(t);
  for (const query of [
    "missingAccount=BAD",
    "missingAccount=EMAIL&missingAccount=SATP",
    `search=${"x".repeat(201)}`,
  ])
    assert.equal((await get(`/students/export?${query}`)).status, 400);
  assert.equal(calls.length, 0);
});

test("export remains available when no academic period is current", async (t) => {
  const { get } = await setup(t, { noCurrent: true, count: 0 });
  const response = await get("/students/export");
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition"),
    /no-current-period/,
  );
});

test("export database failures return an error without a downloadable workbook", async (t) => {
  const { get } = await setup(t, { fail: true });
  const response = await get("/students/export");
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("content-disposition"), null);
  assert.equal((await response.json()).message, "Test export failure");
});
