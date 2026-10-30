import assert from "node:assert/strict";
import { after, test } from "node:test";
import ExcelJS from "exceljs";
import { pool } from "../config/db.js";
import { workbookBuffer } from "../services/workbook.service.js";
import { decryptPassword } from "../services/encryption.service.js";
import {
  downloadImportTemplate,
  importData,
  validateDataImport,
} from "../controllers/bulk-import.controller.js";
import {
  createImportStore,
  importAccountTypes,
} from "./helpers/import-store.js";

after(() => pool.end());

function setup(t, options) {
  const store = createImportStore(options);
  t.mock.method(pool, "query", store.query);
  t.mock.method(pool, "execute", store.execute);
  t.mock.method(pool, "getConnection", async () => store.connection);
  return store;
}

const studentRow = (SchoolID, extras = {}) => ({
  SchoolID,
  FirstName: "Test",
  MiddleName: "",
  LastName: "Student",
  BirthDate: "2005-01-01",
  CourseCode: "BSIT",
  ...extras,
});

async function invoke(handler, rows, query = {}) {
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
  await handler(
    {
      params: { type: "students" },
      query,
      file: {
        originalname: "complete-students.xlsx",
        buffer: await workbookBuffer(rows, "Students"),
      },
    },
    res,
  );
  return res;
}

test("student template includes optional email and account passwords with a blank Kumosoft ID", async () => {
  let buffer;
  await downloadImportTemplate(
    { params: { type: "students" } },
    {
      set() {
        return this;
      },
      send(value) {
        buffer = value;
      },
    },
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const headers = sheet.getRow(1).values.slice(1);
  for (const header of [
    "YearLevel",
    "KumosoftID",
    "EmailAddress",
    "EmailPassword",
    "SATPPassword",
    "SchoologyPassword",
    "KumosoftPassword",
  ])
    assert.ok(headers.includes(header), header);
  for (const header of [
    "KumosoftID",
    "EmailPassword",
    "SATPPassword",
    "SchoologyPassword",
    "KumosoftPassword",
  ])
    assert.equal(sheet.getRow(2).getCell(headers.indexOf(header) + 1).text, "");
});

test("one XLSX row imports a complete student and four encrypted accounts with optional Kumosoft ID", async (t) => {
  const store = setup(t);
  const row = studentRow("D", {
    YearLevel: "2",
    EmailAddress: "D@Example.edu",
    EmailPassword: "email-secret",
    SATPPassword: "satp-secret",
    SchoologyPassword: "schoology-secret",
    KumosoftPassword: "kumosoft-secret",
  });
  const preview = await invoke(validateDataImport, [row]);
  assert.equal(preview.statusCode, 200, preview.body.message);
  assert.deepEqual(
    [preview.body.new, preview.body.update, preview.body.invalid],
    [1, 0, 0],
  );
  for (const secret of [
    "email-secret",
    "satp-secret",
    "schoology-secret",
    "kumosoft-secret",
  ])
    assert.ok(!JSON.stringify(preview.body).includes(secret));
  assert.ok(!Object.hasOwn(preview.body.preview[0], "accounts"));
  const imported = await invoke(importData, [row]);
  assert.equal(imported.statusCode, 200, imported.body.message);
  const student = store.state.students.find((item) => item.student_id === "D");
  assert.equal(student.year_level, 2);
  assert.equal(student.academic_period_id, 7);
  assert.equal(student.kumosoft_id, null);
  for (const [type, table] of Object.entries(importAccountTypes)) {
    const account = store.state.accounts[table].find(
      (item) => item.student_id === student.id,
    );
    assert.equal(
      account.account_name,
      type === "email" ? "d@example.edu" : "D",
    );
    assert.equal(decryptPassword(account), `${type}-secret`);
    assert.notEqual(account.encrypted_password, `${type}-secret`);
  }
  const repeated = await invoke(importData, [row]);
  assert.deepEqual(
    [repeated.body.inserted, repeated.body.updated, repeated.body.unchanged],
    [0, 0, 1],
  );
});

test("blank passwords preserve exact saved credentials while an email address is updated", async (t) => {
  const store = setup(t);
  store.state.students[0].year_level = 3;
  const before = structuredClone(store.state.accounts);
  const result = await invoke(importData, [
    studentRow("A", {
      EmailAddress: "new-a@example.edu",
      EmailPassword: "",
      SATPPassword: "  ",
      SchoologyPassword: "",
      KumosoftPassword: "",
      KumosoftID: "",
      YearLevel: "",
    }),
  ]);
  assert.equal(result.statusCode, 200, result.body.message);
  assert.equal(result.body.updated, 1);
  assert.equal(store.state.students[0].kumosoft_id, "K-A");
  assert.equal(store.state.students[0].year_level, 3);
  for (const table of Object.values(importAccountTypes)) {
    const account = store.state.accounts[table][0];
    assert.equal(
      account.encrypted_password,
      before[table][0].encrypted_password,
    );
    assert.equal(account.password_iv, before[table][0].password_iv);
    assert.equal(account.password_auth_tag, before[table][0].password_auth_tag);
  }
  assert.equal(
    store.state.accounts.institutional_email_accounts[0].account_name,
    "new-a@example.edu",
  );
});

test("account-only changes count as student updates with password-free preview details", async (t) => {
  const store = setup(t);
  const row = studentRow("A", { SATPPassword: "replacement-secret" });
  const preview = await invoke(validateDataImport, [row]);
  assert.deepEqual(
    [preview.body.new, preview.body.update, preview.body.unchanged],
    [0, 1, 0],
  );
  assert.deepEqual(preview.body.groups.update.records[0].changes, [
    { field: "SATP password", message: "Will be replaced." },
  ]);
  assert.ok(!JSON.stringify(preview.body).includes("replacement-secret"));
  await invoke(importData, [row]);
  assert.equal(
    decryptPassword(store.state.accounts.satp_accounts[0]),
    "replacement-secret",
  );
  const repeated = await invoke(validateDataImport, [row]);
  assert.deepEqual([repeated.body.update, repeated.body.unchanged], [0, 1]);
});

test("supplied passwords keep significant whitespace while whitespace-only cells remain optional", async (t) => {
  const store = setup(t);
  const result = await invoke(importData, [
    studentRow("A", {
      SATPPassword: "  exact password  ",
      SchoologyPassword: "   ",
    }),
  ]);
  assert.equal(result.statusCode, 200, result.body.message);
  assert.equal(
    decryptPassword(store.state.accounts.satp_accounts[0]),
    "  exact password  ",
  );
  assert.equal(
    decryptPassword(store.state.accounts.schoology_accounts[0]),
    "same-secret",
  );
});

test("new students may omit all account fields or link email and Kumosoft without passwords", async (t) => {
  const store = setup(t);
  const result = await invoke(importData, [
    studentRow("D", {
      EmailAddress: "",
      SATPPassword: "",
      SchoologyPassword: "",
      KumosoftID: "",
    }),
    studentRow("E", {
      EmailAddress: "e@example.edu",
      KumosoftID: "K-E",
      EmailPassword: "",
      KumosoftPassword: "",
    }),
  ]);
  assert.equal(result.statusCode, 200, result.body.message);
  assert.equal(result.body.inserted, 2);
  const d = store.state.students.find((student) => student.student_id === "D");
  const e = store.state.students.find((student) => student.student_id === "E");
  for (const table of Object.values(importAccountTypes))
    assert.ok(
      !store.state.accounts[table].some(
        (account) => account.student_id === d.id,
      ),
    );
  for (const type of ["email", "kumosoft"]) {
    const account = store.state.accounts[importAccountTypes[type]].find(
      (account) => account.student_id === e.id,
    );
    assert.equal(
      account.account_name,
      type === "email" ? "e@example.edu" : "K-E",
    );
    assert.equal(decryptPassword(account), null);
  }
});

test("optional Kumosoft ID uses the saved student ID when creating a missing account", async (t) => {
  const store = setup(t);
  const result = await invoke(importData, [
    studentRow("C", { KumosoftPassword: "new-secret" }),
  ]);
  assert.equal(result.statusCode, 200, result.body.message);
  assert.equal(
    store.state.accounts.kumosoft_accounts.find(
      (account) => account.student_id === 3,
    ).account_name,
    "K-C",
  );
});

test("email passwords can update existing accounts without repeating the email address", async (t) => {
  const store = setup(t);
  const result = await invoke(importData, [
    studentRow("A", { EmailPassword: "new-email-secret" }),
  ]);
  assert.equal(result.statusCode, 200, result.body.message);
  assert.equal(
    decryptPassword(store.state.accounts.institutional_email_accounts[0]),
    "new-email-secret",
  );
  assert.equal(
    store.state.accounts.institutional_email_accounts[0].account_name,
    "a@example.edu",
  );
});

test("invalid optional account data skips its whole student row while valid rows import", async (t) => {
  const store = setup(t);
  const result = await invoke(importData, [
    studentRow("BAD", { EmailPassword: "must-not-appear" }),
    studentRow("INVALID", { EmailAddress: "not-an-email" }),
    studentRow("D", { EmailAddress: "d@example.edu" }),
  ]);
  assert.equal(result.statusCode, 200, result.body.message);
  assert.deepEqual([result.body.inserted, result.body.invalid], [1, 2]);
  assert.ok(
    !store.state.students.some((student) =>
      ["BAD", "INVALID"].includes(student.student_id),
    ),
  );
  assert.ok(!JSON.stringify(result.body.errors).includes("must-not-appear"));
});

test("duplicate email addresses and accounts owned by other students are rejected before writes", async (t) => {
  const store = setup(t);
  const result = await invoke(importData, [
    studentRow("D", { EmailAddress: "d@example.edu" }),
    studentRow("E", { EmailAddress: "D@EXAMPLE.EDU" }),
    studentRow("F", { EmailAddress: "a@example.edu" }),
  ]);
  assert.equal(result.statusCode, 200, result.body.message);
  assert.deepEqual([result.body.inserted, result.body.invalid], [1, 2]);
  assert.equal(
    store.state.accounts.institutional_email_accounts[0].account_name,
    "a@example.edu",
  );
  assert.equal(store.state.students.length, 4);
});

test("year level is optional, validated, and included in changed-row counts", async (t) => {
  const store = setup(t);
  const invalid = await invoke(
    validateDataImport,
    ["0", "256", "-1", "1.5"].map((YearLevel, index) =>
      studentRow(`INVALID${index}`, { YearLevel }),
    ),
  );
  assert.equal(invalid.body.invalid, 4);
  const result = await invoke(importData, [
    studentRow("A", { YearLevel: "4" }),
  ]);
  assert.equal(result.body.updated, 1);
  assert.equal(store.state.students[0].year_level, 4);
  const repeated = await invoke(validateDataImport, [
    studentRow("A", { YearLevel: "4" }),
  ]);
  assert.equal(repeated.body.unchanged, 1);
});

test("a late account write failure rolls back students and every account together", async (t) => {
  const store = setup(t, { failAccountId: 4 });
  const before = structuredClone(store.state);
  const result = await invoke(importData, [
    studentRow("D", {
      SATPPassword: "new-secret",
      EmailAddress: "d@example.edu",
    }),
  ]);
  assert.equal(result.statusCode, 500);
  assert.deepEqual(store.state, before);
});
