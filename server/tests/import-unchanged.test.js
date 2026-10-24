import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { workbookBuffer } from "../services/workbook.service.js";
import {
  decryptPassword,
  encryptPassword,
} from "../services/encryption.service.js";
import {
  validateDataImport,
  importData,
} from "../controllers/bulk-import.controller.js";
import {
  validateCourseImport,
  importCourses,
} from "../controllers/course-admin.controller.js";
import {
  validateVoucherImport,
  importVouchers,
} from "../controllers/voucher-admin.controller.js";
import {
  createImportStore,
  importAccountTypes,
  importLogin,
} from "./helpers/import-store.js";

after(() => pool.end());
function database(t, options) {
  const store = createImportStore(options);
  t.mock.method(pool, "query", store.query);
  t.mock.method(pool, "execute", store.execute);
  t.mock.method(pool, "getConnection", async () => store.connection);
  return store;
}
async function invoke(handler, type, rows, query = {}) {
  const file = {
    originalname: "import.xlsx",
    buffer: await workbookBuffer(rows, "Import"),
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  await handler({ params: { type }, query, file }, res);
  return res;
}
const accountRow = (type, SchoolID, Password = "same-secret") => ({
  SchoolID,
  Password,
  KumosoftID: importLogin("kumosoft", SchoolID),
  EmailAddress: importLogin("email", SchoolID),
});
const studentRow = (SchoolID) => ({
  SchoolID,
  KumosoftID: `K-${SchoolID}`,
  FirstName: "Test",
  MiddleName: "",
  LastName: "Student",
  BirthDate: "2005-01-01",
  CourseCode: "BSIT",
});

for (const [type, table] of Object.entries(importAccountTypes)) {
  test(`${type}: identical linked and pending credentials are unchanged; only new and changed accounts are written`, async (t) => {
    const store = database(t),
      rows = ["A", "B", "C", "P", "Q", "R"].map((id) => accountRow(type, id));
    const oldAccount = structuredClone(
      store.state.accounts[table].find((a) => a.student_id === 1),
    );
    const oldPending = structuredClone(
      store.state.pending.find(
        (p) => p.account_type === type && p.school_id === "P",
      ),
    );
    const preview = await invoke(validateDataImport, type, rows);
    assert.equal(preview.statusCode, 200, preview.body.message);
    assert.deepEqual(
      [
        preview.body.new,
        preview.body.update,
        preview.body.unchanged,
        preview.body.invalid,
      ],
      [2, 2, 2, 0],
    );
    assert.deepEqual(
      preview.body.groups.unchanged.records.map((r) => r.row),
      [2, 5],
    );
    for (const record of preview.body.groups.update.records) {
      assert.deepEqual(record.changes, [
        { field: "Password", message: "Will be replaced." },
      ]);
    }
    assert.ok(
      preview.body.groups.unchanged.records.every(
        (r) => r.changes.length === 0,
      ),
    );
    assert.ok(
      preview.body.groups.new.records.every((r) => r.changes.length === 0),
    );
    for (const field of [
      "same-secret",
      oldAccount.encrypted_password,
      oldAccount.password_iv,
      oldAccount.password_auth_tag,
    ]) {
      assert.ok(!JSON.stringify(preview.body.groups).includes(field));
      assert.ok(!JSON.stringify(preview.body.preview).includes(field));
    }
    const imported = await invoke(importData, type, rows);
    assert.equal(imported.statusCode, 200, imported.body.message);
    assert.deepEqual(
      [
        imported.body.inserted,
        imported.body.updated,
        imported.body.unchanged,
        imported.body.pending,
      ],
      [2, 2, 2, 2],
    );
    assert.deepEqual(
      store.state.accounts[table].find((a) => a.student_id === 1),
      oldAccount,
    );
    assert.deepEqual(
      store.state.pending.find(
        (p) => p.account_type === type && p.school_id === "P",
      ),
      oldPending,
    );
    assert.equal(
      decryptPassword(
        store.state.accounts[table].find((a) => a.student_id === 2),
      ),
      "same-secret",
    );
    const before = store.calls.length;
    const repeated = await invoke(importData, type, rows);
    assert.deepEqual(
      [repeated.body.inserted, repeated.body.updated, repeated.body.unchanged],
      [0, 0, 6],
    );
    assert.ok(
      !store.calls
        .slice(before)
        .some(
          ({ sql }) =>
            sql.startsWith(`INSERT INTO ${table}`) ||
            sql.startsWith("INSERT INTO pending_account_imports") ||
            sql.startsWith("UPDATE students"),
        ),
    );
  });

  test(`${type}: inactive accounts still count as updates even with identical login and password`, async (t) => {
    const store = database(t);
    store.state.accounts[table][0].is_active = 0;
    const result = await invoke(importData, type, [accountRow(type, "A")]);
    assert.equal(result.body.updated, 1);
    assert.equal(result.body.unchanged, 0);
    assert.equal(store.state.accounts[table][0].is_active, 1);
  });
}

test("account password equality compares decrypted values, while changed passwords still update", async (t) => {
  const store = database(t);
  const oldCipher = store.state.accounts.satp_accounts[0].encrypted_password;
  const same = await invoke(validateDataImport, "satp", [
    accountRow("satp", "A"),
  ]);
  assert.equal(same.body.unchanged, 1);
  const changed = await invoke(importData, "satp", [
    accountRow("satp", "A", "different-secret"),
  ]);
  assert.equal(changed.body.updated, 1);
  assert.equal(
    decryptPassword(store.state.accounts.satp_accounts[0]),
    "different-secret",
  );
  assert.notEqual(
    store.state.accounts.satp_accounts[0].encrypted_password,
    oldCipher,
  );
});

test("email changes and Kumosoft profile ID repairs count as real changes", async (t) => {
  const store = database(t);
  const email = await invoke(importData, "email", [
    { ...accountRow("email", "A"), EmailAddress: "new@example.edu" },
  ]);
  assert.equal(email.body.updated, 1);
  assert.equal(
    store.state.accounts.institutional_email_accounts[0].account_name,
    "new@example.edu",
  );
  store.state.students[0].kumosoft_id = null;
  const kumosoft = await invoke(importData, "kumosoft", [
    accountRow("kumosoft", "A"),
  ]);
  assert.equal(kumosoft.body.updated, 1);
  assert.equal(store.state.students[0].kumosoft_id, "K-A");
});

test("empty Kumosoft passwords are unchanged only when no stored password exists", async (t) => {
  const store = database(t);
  Object.assign(store.state.accounts.kumosoft_accounts[0], {
    encrypted_password: "",
    password_iv: "",
    password_auth_tag: "",
  });
  const result = await invoke(importData, "kumosoft", [
    accountRow("kumosoft", "A", ""),
    accountRow("kumosoft", "B", ""),
  ]);
  assert.deepEqual([result.body.updated, result.body.unchanged], [1, 1]);
  assert.equal(
    decryptPassword(store.state.accounts.kumosoft_accounts[1]),
    null,
  );
});

test("an unreadable encrypted password needs an update instead of silently being skipped", async (t) => {
  const store = database(t);
  store.state.accounts.satp_accounts[0].password_auth_tag =
    Buffer.alloc(16).toString("base64");
  const result = await invoke(importData, "satp", [accountRow("satp", "A")]);
  assert.equal(result.body.updated, 1);
  assert.equal(
    decryptPassword(store.state.accounts.satp_accounts[0]),
    "same-secret",
  );
});

test("older databases without a pending table can still preview unchanged linked accounts", async (t) => {
  database(t, { noPendingTable: true });
  const result = await invoke(validateDataImport, "satp", [
    accountRow("satp", "A"),
  ]);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.unchanged, 1);
});

test("pending account read failures cannot be mistaken for new or unchanged records", async (t) => {
  database(t, { failPendingRead: true });
  const result = await invoke(validateDataImport, "satp", [
    accountRow("satp", "A"),
  ]);
  assert.equal(result.statusCode, 500);
});

test("a late row conflict is skipped and reported while unchanged accounts remain untouched", async (t) => {
  const store = database(t, { failAccountId: 2 });
  const before = structuredClone(
    store.state.accounts.institutional_email_accounts,
  );
  const result = await invoke(importData, "email", [
    accountRow("email", "A"),
    accountRow("email", "B"),
  ]);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    [result.body.updated, result.body.unchanged, result.body.invalid],
    [0, 1, 1],
  );
  assert.ok(result.body.errorReport);
  assert.equal(result.body.errors[0].row, 3);
  assert.deepEqual(store.state.accounts.institutional_email_accounts, before);
});

test("student file imports count only changed profiles or enrollment and preserve identical rows", async (t) => {
  const store = database(t),
    rows = ["A", "B", "D"].map(studentRow);
  const before = structuredClone(store.state.students[0]);
  const preview = await invoke(validateDataImport, "students", rows);
  assert.deepEqual(
    [preview.body.new, preview.body.update, preview.body.unchanged],
    [1, 1, 1],
  );
  const result = await invoke(importData, "students", rows);
  assert.deepEqual(
    [result.body.inserted, result.body.updated, result.body.unchanged],
    [1, 1, 1],
  );
  assert.deepEqual(store.state.students[0], before);
  const repeated = await invoke(importData, "students", rows);
  assert.deepEqual(
    [repeated.body.inserted, repeated.body.updated, repeated.body.unchanged],
    [0, 0, 3],
  );
  const profile = store.state.students[0];
  profile.academic_period_id = 6;
  const period = await invoke(importData, "students", [studentRow("A")]);
  assert.equal(period.body.updated, 1);
  assert.equal(store.state.students[0].academic_period_id, 7);
});

test("already inactive students are unchanged in deactivation imports", async (t) => {
  const store = database(t);
  store.state.students[1].is_active = 0;
  const rows = ["A", "B", "C"].map((SchoolID) => ({ SchoolID }));
  const preview = await invoke(validateDataImport, "student-deactivate", rows);
  assert.deepEqual([preview.body.new, preview.body.unchanged], [2, 1]);
  const result = await invoke(importData, "student-deactivate", rows);
  assert.deepEqual([result.body.deactivated, result.body.unchanged], [2, 1]);
  const before = store.calls.length;
  const repeated = await invoke(importData, "student-deactivate", rows);
  assert.deepEqual(
    [repeated.body.deactivated, repeated.body.unchanged],
    [0, 3],
  );
  assert.ok(
    !store.calls
      .slice(before)
      .some(({ sql }) => sql.startsWith("UPDATE students")),
  );
});

test("course imports keep identical courses and count actual name or level changes", async (t) => {
  const store = database(t);
  const rows = [
    { CourseCode: "BSIT", CourseName: "Information Technology" },
    {
      CourseCode: "CHANGE",
      CourseName: "After",
      AcademicLevel: "GRADUATE_SCHOOL",
    },
    { CourseCode: "CASE", CourseName: "upper", AcademicLevel: "COLLEGE" },
    { CourseCode: "NEW", CourseName: "New course", AcademicLevel: "OTHER" },
  ];
  const preview = await invoke(validateCourseImport, "courses", rows);
  assert.deepEqual(preview.body.groups.update.records[0].changes, [
    { field: "Course name", before: "Before", after: "After" },
    { field: "Academic level", before: "College", after: "Graduate school" },
  ]);
  assert.deepEqual(preview.body.groups.update.records[1].changes, [
    { field: "Course name", before: "UPPER", after: "upper" },
  ]);
  assert.deepEqual(
    [preview.body.new, preview.body.update, preview.body.unchanged],
    [1, 2, 1],
  );
  const before = structuredClone(store.state.courses[0]);
  const result = await invoke(importCourses, "courses", rows);
  assert.deepEqual(
    [result.body.inserted, result.body.updated, result.body.unchanged],
    [1, 2, 1],
  );
  assert.deepEqual(store.state.courses[0], before);
  const repeated = await invoke(importCourses, "courses", rows);
  assert.deepEqual(
    [repeated.body.inserted, repeated.body.updated, repeated.body.unchanged],
    [0, 0, 4],
  );
});

test("voucher imports separate unchanged codes from repeated file rows without reviving released vouchers", async (t) => {
  const store = database(t),
    before = structuredClone(store.state.vouchers[0]);
  const rows = ["EXISTING", "NEW", "EXISTING", "new", ""].map(
    (VoucherCode) => ({ VoucherCode, Other: "row" }),
  );
  const preview = await invoke(validateVoucherImport, "vouchers", rows);
  assert.deepEqual(
    [
      preview.body.new,
      preview.body.update,
      preview.body.unchanged,
      preview.body.duplicates,
      preview.body.invalid,
    ],
    [1, 0, 1, 2, 1],
  );
  assert.equal(preview.body.groups.unchanged.records[0].row, 2);
  assert.deepEqual(
    preview.body.groups.duplicate.records.map((r) => r.row),
    [4, 5],
  );
  const result = await invoke(importVouchers, "vouchers", rows);
  assert.deepEqual(
    [
      result.body.added,
      result.body.updated,
      result.body.unchanged,
      result.body.duplicates,
      result.body.invalid,
    ],
    [1, 0, 1, 2, 1],
  );
  assert.deepEqual(store.state.vouchers[0], before);
  const repeated = await invoke(importVouchers, "vouchers", rows);
  assert.deepEqual([repeated.body.added, repeated.body.unchanged], [0, 2]);
});

test("unchanged account preview pages preserve totals without exposing stored passwords", async (t) => {
  const store = database(t),
    rows = [];
  for (let index = 0; index < 263; index++) {
    const schoolId = `SAME${index}`,
      id = index + 10;
    store.state.students.push({ id, student_id: schoolId });
    store.state.accounts.satp_accounts.push({
      student_id: id,
      account_name: schoolId,
      is_active: 1,
      ...encryptPassword("same-secret"),
    });
    rows.push(accountRow("satp", schoolId));
  }
  const initial = await invoke(validateDataImport, "satp", rows);
  assert.deepEqual(
    [initial.body.new, initial.body.update, initial.body.unchanged],
    [0, 0, 263],
  );
  assert.equal(initial.body.groups.unchanged.records.length, 250);
  const more = await invoke(validateDataImport, "satp", rows, {
    category: "unchanged",
    offset: "250",
  });
  assert.equal(more.body.page.records.length, 13);
  assert.equal(more.body.page.recordTotal, 263);
  assert.ok(!JSON.stringify(more.body).includes("same-secret"));
});

test("student previews describe every changed field with its saved and imported values", async (t) => {
  const store = database(t);
  Object.assign(store.state.students[0], {
    middle_name: "Middle",
    academic_period_id: 6,
    is_active: 0,
  });
  const row = {
    ...studentRow("A"),
    FirstName: "New",
    LastName: "After",
    KumosoftID: "NEW-A",
    BirthDate: "2006-03-04",
    CourseCode: "CHANGE",
  };
  const preview = await invoke(validateDataImport, "students", [
    row,
    studentRow("C"),
    studentRow("D"),
  ]);
  const changes = [
    { field: "First name", before: "Test", after: "New" },
    { field: "Middle name", before: "Middle", after: "" },
    { field: "Last name", before: "Student", after: "After" },
    { field: "Kumosoft ID", before: "K-A", after: "NEW-A" },
    { field: "Birthday", before: "2005-01-01", after: "2006-03-04" },
    { field: "Course", before: "BSIT", after: "CHANGE" },
    {
      field: "Academic period",
      before: "2025-2026 · Second semester",
      after: "2026-2027 · First semester",
    },
    { field: "Status", before: "Inactive", after: "Active" },
  ];
  assert.deepEqual(preview.body.groups.update.records[0].changes, changes);
  assert.deepEqual(preview.body.groups.unchanged.records[0].changes, []);
  assert.deepEqual(preview.body.groups.new.records[0].changes, []);
  const page = await invoke(validateDataImport, "students", [row], {
    category: "update",
    offset: "0",
  });
  assert.deepEqual(page.body.page.records[0].changes, changes);
  assert.ok(
    store.calls.every(({ sql }) => sql.startsWith("SELECT")),
    "Review must stay read-only",
  );
});

test("account previews identify login, reactivation, and Kumosoft profile changes without inventing a password change", async (t) => {
  const store = database(t);
  store.state.accounts.institutional_email_accounts[0].is_active = 0;
  const email = await invoke(validateDataImport, "email", [
    { ...accountRow("email", "A"), EmailAddress: "new@example.edu" },
  ]);
  assert.deepEqual(email.body.groups.update.records[0].changes, [
    {
      field: "Email address",
      before: "a@example.edu",
      after: "new@example.edu",
    },
    { field: "Status", before: "Inactive", after: "Active" },
  ]);
  store.state.students[0].kumosoft_id = "OLD-A";
  const kumosoft = await invoke(validateDataImport, "kumosoft", [
    accountRow("kumosoft", "A", ""),
  ]);
  assert.deepEqual(kumosoft.body.groups.update.records[0].changes, [
    { field: "Password", message: "Will be cleared." },
    { field: "Student Kumosoft ID", before: "OLD-A", after: "K-A" },
  ]);
  for (const result of [email, kumosoft]) {
    assert.ok(!JSON.stringify(result.body).includes("same-secret"));
    assert.ok(!JSON.stringify(result.body).includes("encrypted_password"));
  }
});

test("changed account details remain available on later preview pages without exposing either password", async (t) => {
  const store = database(t),
    rows = [];
  for (let index = 0; index < 253; index++) {
    const id = index + 10,
      schoolId = `UPDATE${index}`;
    store.state.students.push({ id, student_id: schoolId });
    store.state.accounts.schoology_accounts.push({
      student_id: id,
      account_name: schoolId,
      is_active: 1,
      ...encryptPassword("old-private-password"),
    });
    rows.push(accountRow("schoology", schoolId, "new-private-password"));
  }
  const preview = await invoke(validateDataImport, "schoology", rows);
  assert.equal(preview.body.update, 253);
  assert.equal(preview.body.groups.update.hasMore, true);
  const page = await invoke(validateDataImport, "schoology", rows, {
    category: "update",
    offset: "250",
  });
  assert.equal(page.body.page.records.length, 3);
  for (const record of page.body.page.records)
    assert.deepEqual(record.changes, [
      { field: "Password", message: "Will be replaced." },
    ]);
  for (const result of [preview, page]) {
    assert.ok(!JSON.stringify(result.body).includes("old-private-password"));
    assert.ok(!JSON.stringify(result.body).includes("new-private-password"));
  }
});
