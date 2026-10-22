import assert from "node:assert/strict";
import { test, after } from "node:test";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import { encryptPassword } from "../services/encryption.service.js";
import {
  credentials,
  revealCredentials,
  requestAccount,
} from "../controllers/kiosk.controller.js";
import {
  validateCourseImport,
  importCourses,
} from "../controllers/course-admin.controller.js";
import { inferAcademicLevel } from "../services/course-level.service.js";
import { workbookBuffer } from "../services/workbook.service.js";

after(() => pool.end());

const accountRows = ["SATP", "EMAIL", "SCHOOLOGY", "KUMOSOFT"].map((type) => ({
  credential_type: type,
  username: "test-account",
  has_password: type !== "SATP" ? 1 : 0,
  ...(type === "SATP"
    ? { encrypted_password: null }
    : encryptPassword("test-password")),
}));

function setup(t, academicLevel = "COLLEGE") {
  const writes = [];
  const execute = async (sql, values) => {
    if (sql.includes("FROM kiosk_credential_sessions"))
      return [[{ student_id: 7 }]];
    if (sql.includes("SELECT academic_period_id FROM students"))
      return [[{ academic_period_id: 1 }]];
    if (sql.includes("FROM academic_periods")) return [[{ id: 1 }]];
    if (sql.includes("FROM credential_module_controls"))
      return [
        accountRows.map((row) => ({
          module_key: row.credential_type,
          is_visible: 1,
          is_maintenance: 0,
        })),
      ];
    if (sql.includes("FROM students s JOIN courses"))
      return [
        [
          {
            student_id: "TEST-1",
            academic_level: academicLevel,
            first_name: "Test",
            course_code: "TEST",
            course_name: "Test course",
          },
        ],
      ];
    if (sql.includes("'SATP' credential_type")) return [accountRows];
    if (sql.includes("FROM password_reset_requests")) return [[]];
    if (sql.includes("SELECT w.voucher_code"))
      return [[{ voucher_code: "TEST-VOUCHER" }]];
    if (sql.includes("FROM courses WHERE code IN"))
      return [
        [
          {
            id: 1,
            code: "TEST",
            name: "Test course",
            academic_level: academicLevel,
          },
        ],
      ];
    if (/^(INSERT|UPDATE)/.test(sql)) {
      writes.push({ sql, values });
      return [{ insertId: 1, affectedRows: 1 }];
    }
    if (/^(SAVEPOINT|RELEASE SAVEPOINT)/.test(sql)) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const connection = {
    execute,
    query: execute,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
  };
  t.mock.method(pool, "execute", execute);
  t.mock.method(pool, "query", execute);
  t.mock.method(pool, "getConnection", async () => connection);
  const token = jwt.sign(
    { sub: 7, jti: "test", scope: "kiosk-credentials" },
    config().accessSecret,
  );
  const req = {
    headers: { authorization: `Bearer ${token}` },
    body: { credentialType: "SATP" },
    header: () => "test",
  };
  const res = {
    statusCode: 200,
    status(value) {
      this.statusCode = value;
      return this;
    },
    set() {
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  return { req, res, writes };
}

for (const level of ["COLLEGE", "GRADUATE_SCHOOL", "OTHER"]) {
  test(`${level}: kiosk summary only offers SATP to college students`, async (t) => {
    const { req, res } = setup(t, level);
    await credentials(req, res);
    assert.equal(res.statusCode, 200);
    const satp = res.body.credentials.find((row) => row.type === "SATP");
    assert.equal(Boolean(satp), level === "COLLEGE");
    if (satp) assert.equal(satp.hasPassword, false);
    assert.ok(res.body.credentials.some((row) => row.type === "EMAIL"));
    assert.ok(res.body.credentials.every((row) => !("password" in row)));
  });

  test(`${level}: revealing credentials cannot bypass SATP eligibility`, async (t) => {
    const { req, res } = setup(t, level);
    await revealCredentials(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(
      res.body.credentials.some((row) => row.type === "SATP"),
      level === "COLLEGE",
    );
    assert.ok(res.body.credentials.some((row) => row.type === "EMAIL"));
  });
}

for (const level of ["GRADUATE_SCHOOL", "OTHER"]) {
  test(`${level}: direct SATP account requests are refused`, async (t) => {
    const { req, res, writes } = setup(t, level);
    await requestAccount(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(writes.length, 0);
  });
}

test("old course files preserve an existing graduate classification", async (t) => {
  const { res, writes } = setup(t, "GRADUATE_SCHOOL");
  const req = {
    file: {
      originalname: "courses.xlsx",
      buffer: await workbookBuffer(
        [{ CourseCode: "TEST", CourseName: "Updated name" }],
        "Courses",
      ),
    },
  };
  await importCourses(req, res);
  assert.equal(res.statusCode, 200);
  const update = writes.find((row) => row.sql.startsWith("UPDATE courses"));
  assert.equal(update.values[1], "GRADUATE_SCHOOL");
});

test("course imports classify explicit levels and report invalid rows", async (t) => {
  const { res } = setup(t);
  const req = {
    file: {
      originalname: "courses.xlsx",
      buffer: await workbookBuffer(
        [
          {
            CourseCode: "TEST",
            CourseName: "Test course",
            AcademicLevel: "Graduate school",
          },
          {
            CourseCode: "BAD",
            CourseName: "Invalid course",
            AcademicLevel: "unknown",
          },
        ],
        "Courses",
      ),
    },
  };
  await validateCourseImport(req, res);
  assert.equal(res.body.update, 1);
  assert.equal(res.body.preview[0].academicLevel, "GRADUATE_SCHOOL");
  assert.equal(res.body.invalid, 1);
  assert.ok(res.body.errorReport);
});

test("initial classification separates degrees and leaves unclear courses for review", () => {
  assert.equal(
    inferAcademicLevel("BSIT", "Bachelor of Science in Information Technology"),
    "COLLEGE",
  );
  assert.equal(
    inferAcademicLevel("MAED-TESL", "MAED major in TESL"),
    "GRADUATE_SCHOOL",
  );
  assert.equal(
    inferAcademicLevel("PHD", "Doctor of Philosophy"),
    "GRADUATE_SCHOOL",
  );
  assert.equal(
    inferAcademicLevel(
      "STEM",
      "Science, Technology, Engineering & Mathematics",
    ),
    "OTHER",
  );
  assert.equal(inferAcademicLevel("UNCLEAR", "Unspecified program"), "OTHER");
});
