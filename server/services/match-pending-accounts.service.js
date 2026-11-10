import { decryptPassword } from "./encryption.service.js";

const accountTypes = {
  satp: { table: "satp_accounts", column: "username" },
  schoology: { table: "schoology_accounts", column: "username" },
  kumosoft: { table: "kumosoft_accounts", column: "username" },
  email: { table: "institutional_email_accounts", column: "email_address" },
};

// The caller owns the transaction. Match only exact school IDs and never
// replace an account already linked to a student or owned by someone else.
export async function matchPendingAccounts(connection) {
  const counts = {
    matched: 0,
    unmatched: 0,
    existing: 0,
    conflicts: 0,
    invalid: 0,
  };
  let pending;
  try {
    [pending] = await connection.query(
      `SELECT id, account_type, school_id, account_name, encrypted_password, password_iv, password_auth_tag
         FROM pending_account_imports ORDER BY id FOR UPDATE`,
    );
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") return counts;
    throw error;
  }
  if (!pending.length) return counts;
  const [students] = await connection.query(
    "SELECT id, student_id FROM students",
  );
  const studentIds = new Map(
    students.map((student) => [student.student_id, student.id]),
  );
  for (const row of pending) {
    const type = accountTypes[row.account_type];
    if (
      !type ||
      !row.account_name ||
      (!row.encrypted_password && row.account_type !== "kumosoft") ||
      (row.account_type === "email" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.account_name))
    ) {
      counts.invalid++;
      continue;
    }
    const studentId = studentIds.get(row.school_id);
    if (!studentId) {
      counts.unmatched++;
      continue;
    }
    try {
      if (row.encrypted_password) decryptPassword(row);
    } catch {
      counts.invalid++;
      continue;
    }
    const [existing] = await connection.execute(
      `SELECT student_id FROM ${type.table} WHERE student_id=? OR ${type.column}=?`,
      [studentId, row.account_name],
    );
    if (
      existing.some(
        (account) => String(account.student_id) === String(studentId),
      )
    ) {
      counts.existing++;
      continue;
    }
    if (existing.length) {
      counts.conflicts++;
      continue;
    }
    try {
      await connection.execute(
        `INSERT INTO ${type.table} (student_id, ${type.column}, encrypted_password, password_iv, password_auth_tag, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
        [
          studentId,
          row.account_name,
          row.encrypted_password,
          row.password_iv,
          row.password_auth_tag,
        ],
      );
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") throw error;
      counts.conflicts++;
      continue;
    }
    await connection.execute("DELETE FROM pending_account_imports WHERE id=?", [
      row.id,
    ]);
    counts.matched++;
  }
  return counts;
}
