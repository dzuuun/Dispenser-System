import assert from "node:assert/strict";
import { after, test } from "node:test";
import ExcelJS from "exceljs";
import { pool } from "../config/db.js";
import { exportAccountCredentials } from "../controllers/bulk-import.controller.js";
import { encryptPassword } from "../services/encryption.service.js";

after(() => pool.end());

test("all accounts export uses one sheet with the requested columns and retains unmatched imports", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM students s"))
      return [[{ id: 1, student_id: "001", kumosoft_id: "K-1", first_name: "Ana", last_name: "Cruz", course_code: "BSIT", course_name: "Information Technology", is_active: 0 }]];
    if (sql.includes("FROM satp_accounts"))
      return [[{ student_id: 1, account_name: "001", ...encryptPassword("satp-pass") }]];
    if (sql.includes("FROM institutional_email_accounts"))
      return [[{ student_id: 1, account_name: "ana@example.edu", ...encryptPassword("email-pass") }]];
    if (sql.includes("FROM pending_account_imports"))
      return [[
        { account_type: "email", school_id: "002", account_name: "pending@example.edu", ...encryptPassword("pending-email") },
        { account_type: "kumosoft", school_id: "002", account_name: "K-2", ...encryptPassword("pending-kumo") },
      ]];
    return [[]];
  });
  const res = {
    headers: {},
    set(headers) { Object.assign(this.headers, headers); return this; },
    send(body) { this.body = body; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await exportAccountCredentials({}, res);
  assert.equal(res.statusCode, undefined);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.body);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(1).values.slice(1), ["School ID", "Kumosoft ID", "Student name", "Course code", "Course name", "Student status", "Email", "Email password", "Kumosoft password", "Schoology password", "SATP password"]);
  assert.deepEqual(sheet.getRow(2).values.slice(1), ["001", "K-1", "Ana Cruz", "BSIT", "Information Technology", "Inactive", "ana@example.edu", "email-pass", , , "satp-pass"]);
  assert.deepEqual(sheet.getRow(3).values.slice(1), ["002", "K-2", , , , "Unmatched", "pending@example.edu", "pending-email", "pending-kumo"]);
});
