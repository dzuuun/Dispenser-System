import { encryptPassword } from "../../services/encryption.service.js";

export const importAccountTypes = {
  satp: "satp_accounts",
  schoology: "schoology_accounts",
  kumosoft: "kumosoft_accounts",
  email: "institutional_email_accounts",
};
export const importLogin = (type, schoolId) =>
  type === "email"
    ? `${schoolId.toLowerCase()}@example.edu`
    : type === "kumosoft"
      ? `K-${schoolId}`
      : schoolId;

export function createImportStore(options = {}) {
  let stored = {
    students: ["A", "B", "C"].map((student_id, index) => ({
      id: index + 1,
      student_id,
      kumosoft_id: `K-${student_id}`,
      first_name: index === 1 ? "Before" : "Test",
      middle_name: null,
      last_name: "Student",
      birth_date: "2005-01-01",
      course_id: 1,
      academic_period_id: 7,
      is_active: 1,
    })),
    courses: [
      {
        id: 1,
        code: "BSIT",
        name: "Information Technology",
        academic_level: "COLLEGE",
        is_active: 1,
      },
      {
        id: 2,
        code: "CHANGE",
        name: "Before",
        academic_level: "COLLEGE",
        is_active: 1,
      },
      {
        id: 3,
        code: "CASE",
        name: "UPPER",
        academic_level: "COLLEGE",
        is_active: 1,
      },
    ],
    accounts: Object.fromEntries(
      Object.entries(importAccountTypes).map(([type, table]) => [
        table,
        ["A", "B"].map((schoolId, index) => ({
          student_id: index + 1,
          account_name: importLogin(type, schoolId),
          ...encryptPassword(index ? "old-secret" : "same-secret"),
          is_active: 1,
        })),
      ]),
    ),
    pending: Object.keys(importAccountTypes).flatMap((type) =>
      ["P", "Q"].map((schoolId, index) => ({
        account_type: type,
        school_id: schoolId,
        account_name: importLogin(type, schoolId),
        ...encryptPassword(index ? "old-secret" : "same-secret"),
      })),
    ),
    pendingTable: !options.noPendingTable,
    vouchers: [
      {
        voucher_code: "EXISTING",
        is_active: 0,
        is_assigned: 0,
        is_released: 1,
        academic_period_id: 6,
      },
    ],
  };
  let staged, savepoint;
  const calls = [];
  const run = async (sql, values = []) => {
    calls.push({ sql, values });
    const data = staged || stored,
      text = sql.trim();
    const done = (affectedRows = 1) => [{ affectedRows }];
    if (text.includes("FROM academic_periods"))
      return [
        [{ id: 7, school_year: "2026-2027", semester: "First semester" }],
      ];
    if (text.startsWith("SELECT") && text.includes("FROM courses"))
      return [
        structuredClone(
          data.courses.filter((c) =>
            text.includes("WHERE code IN")
              ? values.includes(c.code.toUpperCase())
              : c.is_active,
          ),
        ),
      ];
    if (text.startsWith("SELECT") && text.includes("FROM students"))
      return [
        structuredClone(
          data.students.map((student) => ({
            ...student,
            course_code: data.courses.find((c) => c.id === student.course_id)
              ?.code,
            academic_period_label:
              student.academic_period_id === 7
                ? "2026-2027 · First semester"
                : "2025-2026 · Second semester",
          })),
        ),
      ];
    if (
      text.startsWith("SELECT") &&
      text.includes("FROM pending_account_imports")
    ) {
      if (!data.pendingTable)
        throw Object.assign(new Error("Holding table not created"), {
          code: "ER_NO_SUCH_TABLE",
        });
      if (options.failPendingRead)
        throw Object.assign(new Error("Pending read failed"), {
          code: "ER_ACCESS_DENIED_ERROR",
        });
      return [
        structuredClone(
          data.pending.filter((p) => p.account_type === values[0]),
        ),
      ];
    }
    if (text.startsWith("SELECT") && text.includes("FROM wifi_vouchers"))
      return [structuredClone(data.vouchers)];
    const table = Object.values(importAccountTypes).find(
      (name) =>
        text.includes(`FROM ${name}`) || text.startsWith(`INSERT INTO ${name}`),
    );
    if (text.startsWith("SELECT") && table) {
      const rows = data.accounts[table];
      return [
        structuredClone(
          text.includes("student_id<>?")
            ? rows.filter(
                (a) =>
                  a.account_name.toLowerCase() ===
                    String(values[0]).toLowerCase() &&
                  a.student_id !== values[1],
              )
            : rows,
        ),
      ];
    }
    if (text.startsWith("CREATE TABLE IF NOT EXISTS pending_account_imports")) {
      data.pendingTable = true;
      return done(0);
    }
    if (text === "SAVEPOINT import_row") {
      savepoint = structuredClone(staged);
      return [[]];
    }
    if (text === "ROLLBACK TO SAVEPOINT import_row") {
      staged = savepoint;
      return [[]];
    }
    if (text === "RELEASE SAVEPOINT import_row") {
      savepoint = undefined;
      return [[]];
    }
    if (text.startsWith("INSERT INTO students")) {
      for (let start = 0; start < values.length; start += 8) {
        const [
          schoolId,
          kumosoftId,
          firstName,
          middleName,
          lastName,
          birthday,
          courseId,
          periodId,
        ] = values.slice(start, start + 8);
        let row = data.students.find((s) => s.student_id === schoolId);
        const isNew = !row;
        if (isNew) {
          row = { id: data.students.length + 1, student_id: schoolId };
          data.students.push(row);
        }
        Object.assign(row, {
          first_name: firstName,
          middle_name: middleName,
          last_name: lastName,
          course_id: courseId,
          academic_period_id: periodId,
          is_active: 1,
        });
        if (kumosoftId || isNew) row.kumosoft_id = kumosoftId;
        if (isNew || text.includes("birth_date=VALUES(birth_date)"))
          row.birth_date = birthday;
      }
      return done(values.length / 8);
    }
    if (text.startsWith("UPDATE students SET is_active=0")) {
      const changes = data.students.filter((s) =>
        values.includes(s.student_id),
      );
      changes.forEach((s) => {
        s.is_active = 0;
      });
      return done(changes.length);
    }
    if (text.startsWith("UPDATE students SET kumosoft_id=?")) {
      data.students.find((s) => s.id === values[1]).kumosoft_id = values[0];
      return done();
    }
    if (text.startsWith("UPDATE students SET year_level=?")) {
      data.students.find((s) => s.student_id === values[1]).year_level =
        values[0];
      return done();
    }
    if (text.startsWith("INSERT INTO pending_account_imports")) {
      const [
        type,
        schoolId,
        login,
        encrypted_password,
        password_iv,
        password_auth_tag,
      ] = values;
      let row = data.pending.find(
        (p) => p.account_type === type && p.school_id === schoolId,
      );
      if (!row) {
        row = { account_type: type, school_id: schoolId };
        data.pending.push(row);
      }
      Object.assign(row, {
        account_name: login,
        encrypted_password,
        password_iv,
        password_auth_tag,
      });
      return done();
    }
    if (text.startsWith("INSERT INTO") && table) {
      if (text.includes("SELECT s.id")) {
        for (const pending of data.pending.filter(
          (p) => p.account_type === values[0],
        )) {
          const student = data.students.find(
            (s) => s.student_id === pending.school_id,
          );
          if (!student) continue;
          let row = data.accounts[table].find(
            (a) => a.student_id === student.id,
          );
          if (!row) {
            row = { student_id: student.id };
            data.accounts[table].push(row);
          }
          Object.assign(row, {
            account_name: pending.account_name,
            encrypted_password: pending.encrypted_password,
            password_iv: pending.password_iv,
            password_auth_tag: pending.password_auth_tag,
            is_active: 1,
          });
        }
        return done();
      }
      const [
        studentId,
        login,
        encrypted_password,
        password_iv,
        password_auth_tag,
      ] = values;
      if (options.failAccountId === studentId)
        throw Object.assign(new Error("Late account conflict"), {
          code: "ER_DUP_ENTRY",
        });
      let row = data.accounts[table].find((a) => a.student_id === studentId);
      const isNew = !row;
      if (isNew) {
        row = { student_id: studentId };
        data.accounts[table].push(row);
      }
      Object.assign(row, {
        account_name: login,
        is_active: 1,
      });
      if (
        isNew ||
        text.includes("encrypted_password=VALUES(encrypted_password)")
      ) {
        Object.assign(row, {
          encrypted_password,
          password_iv,
          password_auth_tag,
        });
      }
      return done();
    }
    if (text.startsWith("DELETE p FROM pending_account_imports")) {
      data.pending = data.pending.filter(
        (p) =>
          p.account_type !== values[0] ||
          !data.students.some((s) => s.student_id === p.school_id),
      );
      return done();
    }
    if (text.startsWith("INSERT INTO courses")) {
      data.courses.push({
        id: data.courses.length + 1,
        code: values[0],
        name: values[1],
        academic_level: values[2],
        is_active: 1,
      });
      return done();
    }
    if (text.startsWith("UPDATE courses SET name")) {
      Object.assign(
        data.courses.find((c) => c.id === values[2]),
        { name: values[0], academic_level: values[1] },
      );
      return done();
    }
    if (text.startsWith("INSERT INTO wifi_vouchers")) {
      for (let start = 0; start < values.length; start += 2)
        data.vouchers.push({
          voucher_code: values[start],
          academic_period_id: values[start + 1],
          is_active: 1,
          is_assigned: 0,
          is_released: 0,
        });
      return done(values.length / 2);
    }
    throw new Error(`Unexpected import SQL: ${sql}`);
  };
  const connection = {
    query: run,
    execute: run,
    async beginTransaction() {
      staged = structuredClone(stored);
    },
    async commit() {
      stored = staged;
      staged = undefined;
    },
    async rollback() {
      staged = undefined;
    },
    release() {
      if (staged) throw new Error("Unfinished transaction");
    },
  };
  return {
    get state() {
      return stored;
    },
    calls,
    query: run,
    execute: run,
    connection,
  };
}
