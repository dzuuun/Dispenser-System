import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { workbookBuffer } from "../services/workbook.service.js";
import { importPreview } from "../services/import-preview.service.js";
import { validateDataImport } from "../controllers/bulk-import.controller.js";
import { validateCourseImport } from "../controllers/course-admin.controller.js";
import { validateVoucherImport } from "../controllers/voucher-admin.controller.js";

after(() => pool.end());

test("preview categories page independently without changing counts or source records", () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    row: index + 2,
    label: `Student ${index}`,
  }));
  const groups = { new: rows, update: [{ row: 600 }], error: [] };
  const first = importPreview(groups);
  assert.equal(first.groups.new.records.length, 250);
  assert.equal(first.groups.new.recordTotal, 501);
  assert.equal(first.groups.new.nextOffset, 250);
  assert.equal(first.groups.new.hasMore, true);
  assert.equal(first.groups.update.records.length, 1);
  const second = importPreview(groups, { category: "new", offset: "250" });
  assert.equal(second.category, "new");
  assert.equal(second.page.records[0].row, 252);
  assert.equal(second.page.records.length, 250);
  const last = importPreview(groups, { category: "new", offset: "500" });
  assert.equal(last.page.records[0].row, 502);
  assert.equal(last.page.hasMore, false);
  assert.equal(last.page.nextOffset, 501);
  assert.equal(rows.length, 501);
  assert.deepEqual(
    importPreview(groups, { category: "error" }).page.records,
    [],
  );
  assert.deepEqual(
    importPreview(groups, { category: "new", offset: "999" }).page.records,
    [],
  );
});

test("invalid preview categories and offsets are rejected", () => {
  for (const query of [
    { category: "password" },
    { category: ["new"] },
    { category: "__proto__" },
    { offset: "-1" },
    { offset: "1.5" },
    { offset: ["1"] },
    { offset: "1e2" },
    { offset: "9007199254740992" },
  ])
    assert.throws(() => importPreview({ new: [] }, query), { status: 400 });
});

function database(t) {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    assert.match(sql, /^SELECT/, "Preview must never write to the database");
    if (sql.includes("FROM academic_periods")) return [[{ id: 7 }]];
    if (sql.includes("FROM pending_account_imports")) return [[]];
    if (sql.includes("FROM courses WHERE code IN"))
      return [
        [
          { id: 1, code: "OLD", name: "Old name", academic_level: "COLLEGE" },
          {
            id: 2,
            code: "SAME",
            name: "Same course",
            academic_level: "COLLEGE",
          },
        ],
      ];
    if (sql.includes("FROM courses")) return [[{ id: 1, code: "BSIT" }]];
    if (sql.includes("FROM students"))
      return [
        [
          { id: 1, student_id: "OLD", kumosoft_id: "K-OLD" },
          { id: 2, student_id: "NEW", kumosoft_id: "K-NEW" },
        ],
      ];
    if (sql.includes("FROM wifi_vouchers"))
      return [[{ voucher_code: "EXISTING" }]];
    if (
      /FROM (satp_accounts|schoology_accounts|kumosoft_accounts|institutional_email_accounts)/.test(
        sql,
      )
    )
      return [
        [
          {
            student_id: 1,
            account_name: sql.includes("email_address")
              ? "old@example.edu"
              : sql.includes("kumosoft_accounts")
                ? "K-OLD"
                : "OLD",
          },
        ],
      ];
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "execute", query);
  return calls;
}

async function validate(handler, type, rows, query = {}) {
  const req = {
    params: { type },
    query,
    file: {
      originalname: "import.xlsx",
      buffer: await workbookBuffer(rows, "Import"),
    },
  };
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
  await handler(req, res);
  assert.equal(res.statusCode, 200, res.body?.message);
  return res.body;
}

test("student upload reviews show new, updated, and invalid rows with full category totals", async (t) => {
  database(t);
  const rows = ["BRANDNEW", "OLD"].map((SchoolID) => ({
    SchoolID,
    LastName: "Student",
    FirstName: "Test",
    BirthDate: "2005-01-01",
    CourseCode: "BSIT",
  }));
  rows.push({ SchoolID: "BAD", LastName: "Missing fields" });
  const body = await validate(validateDataImport, "students", rows);
  assert.deepEqual([body.new, body.update, body.invalid], [1, 1, 1]);
  assert.match(body.groups.new.records[0].label, /NEW.*Student, Test.*BSIT/);
  assert.equal(body.groups.update.records[0].row, 3);
  assert.equal(body.groups.error.records[0].row, 4);
  assert.match(body.groups.error.records[0].message, /skipped/);
  assert.ok(body.errorReport);
});

test("student deactivation reviews describe inactivation rather than creation", async (t) => {
  database(t);
  const body = await validate(validateDataImport, "student-deactivate", [
    { SchoolID: "OLD" },
    { SchoolID: "MISSING" },
  ]);
  assert.equal(body.new, 1);
  assert.equal(body.invalid, 1);
  assert.equal(body.groups.new.records[0].label, "OLD");
  assert.match(body.groups.new.records[0].message, /marked inactive/);
});

for (const type of ["satp", "schoology", "kumosoft", "email"]) {
  test(`${type} review separates account creation, updates, pending accounts, and errors without returning passwords`, async (t) => {
    database(t);
    const rows = ["NEW", "OLD", "PENDING"].map((SchoolID) => ({
      SchoolID,
      KumosoftID: `K-${SchoolID}`,
      EmailAddress: `${SchoolID.toLowerCase()}@example.edu`,
      Password: "SecretNotForPreview",
    }));
    rows.push({ SchoolID: "INVALID" });
    const body = await validate(validateDataImport, type, rows);
    assert.equal(body.update, 1);
    // Unmatched accounts are retained for the next student import.
    assert.equal(body.new, 2);
    assert.equal(body.invalid, 1);
    assert.match(
      body.groups.new.records[1].message,
      /until its student is imported/,
    );
    assert.ok(!JSON.stringify(body.groups).includes("SecretNotForPreview"));
    assert.ok(!JSON.stringify(body.preview).includes("SecretNotForPreview"));
    assert.ok(body.errorReport);
  });
}

test("course reviews include unchanged rows alongside new, updated, and invalid courses", async (t) => {
  database(t);
  const body = await validate(validateCourseImport, "courses", [
    {
      CourseCode: "BSIT",
      CourseName: "Information Technology",
      AcademicLevel: "COLLEGE",
    },
    {
      CourseCode: "OLD",
      CourseName: "Updated course",
      AcademicLevel: "COLLEGE",
    },
    { CourseCode: "SAME", CourseName: "Same course", AcademicLevel: "COLLEGE" },
    { CourseCode: "BAD" },
  ]);
  assert.deepEqual(
    [body.new, body.update, body.unchanged, body.invalid],
    [1, 1, 1, 1],
  );
  assert.equal(body.groups.unchanged.records[0].label, "SAME — Same course");
  assert.ok(body.errorReport);
});

test("voucher reviews retain original row numbers and show skipped duplicates separately", async (t) => {
  database(t);
  const body = await validate(validateVoucherImport, "vouchers", [
    { VoucherCode: "NEW" },
    { VoucherCode: "EXISTING" },
    { VoucherCode: "NEW" },
    { VoucherCode: "", Other: "Missing voucher" },
  ]);
  assert.equal(body.new, 1);
  assert.equal(body.duplicates, 1);
  assert.equal(body.unchanged, 1);
  assert.equal(body.groups.new.records[0].row, 2);
  assert.deepEqual(
    body.groups.duplicate.records.map((row) => row.row),
    [4],
  );
  assert.equal(body.groups.unchanged.records[0].row, 3);
  assert.equal(body.groups.error.records[0].row, 5);
  assert.ok(body.errorReport);
});

test("loading more upload rows returns the next page without changing the complete import summary", async (t) => {
  database(t);
  const rows = Array.from({ length: 301 }, (_, index) => ({
    SchoolID: `NEW-${index}`,
    LastName: "Student",
    FirstName: "Test",
    BirthDate: "2005-01-01",
    CourseCode: "BSIT",
  }));
  const initial = await validate(validateDataImport, "students", rows);
  const more = await validate(validateDataImport, "students", rows, {
    category: "new",
    offset: "250",
  });
  assert.equal(initial.new, 301);
  assert.equal(initial.groups.new.records.length, 250);
  assert.equal(more.page.records.length, 51);
  assert.equal(more.page.records[0].row, 252);
  assert.equal(more.page.recordTotal, 301);
  assert.equal(more.page.hasMore, false);
  assert.equal(initial.new, 301);
});
