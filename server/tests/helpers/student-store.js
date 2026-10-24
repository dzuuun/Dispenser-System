import { encryptPassword } from "../../services/encryption.service.js";

export const studentAccountTables = [
  "satp_accounts",
  "schoology_accounts",
  "kumosoft_accounts",
  "institutional_email_accounts",
];

export function createStudentStore() {
  const accounts = Object.fromEntries(
    studentAccountTables.map((table) => [
      table,
      {
        1: {
          id: 10,
          student_id: 1,
          username: "2026001",
          email_address: "student@example.edu",
          ...encryptPassword("Original test password"),
          is_active: 1,
        },
        2: {
          id: 20,
          student_id: 2,
          username: "OTHER",
          email_address: "other@example.edu",
          ...encryptPassword("Other test password"),
          is_active: 1,
        },
      },
    ]),
  );
  let stored = {
    accounts,
    student: {
      id: 1,
      student_id: "2026001",
      kumosoft_id: "K-001",
      first_name: "Test",
      middle_name: "Middle",
      last_name: "Student",
      birth_date: "2005-01-01",
      course_id: 1,
      course_code: "BSIT",
      course_name: "Information Technology",
      is_active: 1,
      voucher_id: null,
    },
  };
  let staged;
  let conflictEmail = false;
  const calls = [];
  const execute = async (sql, values = []) => {
    calls.push({ sql, values });
    const data = staged || stored;
    if (sql.includes("FROM courses WHERE id=?")) return [[{ id: 1 }]];
    if (sql.startsWith("UPDATE students SET student_id=")) {
      if (values.at(-1) !== data.student.id) return [{ affectedRows: 0 }];
      [
        data.student.student_id,
        data.student.kumosoft_id,
        data.student.first_name,
        data.student.middle_name,
        data.student.last_name,
        data.student.birth_date,
        data.student.course_id,
        data.student.is_active,
      ] = values;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM students s JOIN courses"))
      return [[{ ...data.student }]];
    if (sql.includes("SELECT w.voucher_code")) return [[]];
    const table = studentAccountTables.find((name) => sql.includes(name));
    if (!table) throw new Error(`Unexpected student query: ${sql}`);
    const rows = data.accounts[table];
    if (sql.startsWith("SELECT"))
      return [rows[values[0]] ? [{ ...rows[values[0]] }] : []];
    if (sql.startsWith("UPDATE") && sql.includes("SET username=?")) {
      if (rows[values[1]]) rows[values[1]].username = values[0];
      return [{ affectedRows: rows[values[1]] ? 1 : 0 }];
    }
    if (sql.startsWith("UPDATE") && sql.includes("SET encrypted_password=''")) {
      if (!sql.endsWith("WHERE student_id=?"))
        throw new Error("Unscoped password clearing");
      if (rows[values[0]])
        Object.assign(rows[values[0]], {
          encrypted_password: "",
          password_iv: "",
          password_auth_tag: "",
        });
      return [{ affectedRows: rows[values[0]] ? 1 : 0 }];
    }
    if (sql.startsWith("DELETE")) {
      if (!sql.endsWith("WHERE student_id=?"))
        throw new Error("Unscoped account removal");
      delete rows[values[0]];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE") && sql.includes("SET email_address=?")) {
      if (conflictEmail)
        throw Object.assign(new Error("Email is already in use"), {
          code: "ER_DUP_ENTRY",
        });
      rows[values[1]].email_address = values[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT")) {
      rows[values[0]] = {
        ...rows[values[0]],
        student_id: values[0],
        [table === "institutional_email_accounts"
          ? "email_address"
          : "username"]: values[1],
        encrypted_password: values[2],
        password_iv: values[3],
        password_auth_tag: values[4],
        is_active: 1,
      };
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected student query: ${sql}`);
  };
  return {
    get stored() {
      return stored;
    },
    calls,
    execute,
    set conflictEmail(value) {
      conflictEmail = value;
    },
    connection: {
      execute,
      query: execute,
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
      release() {},
    },
  };
}
