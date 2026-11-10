import { pool } from "../config/db.js";
import { decryptPassword } from "../services/encryption.service.js";

const types = {
  satp: { table: "satp_accounts", column: "username" },
  schoology: { table: "schoology_accounts", column: "username" },
  kumosoft: { table: "kumosoft_accounts", column: "username" },
  email: { table: "institutional_email_accounts", column: "email_address" },
};
const apply = process.argv.slice(2).includes("--apply");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (unknownArgs.length) throw new Error(`Unknown argument: ${unknownArgs[0]}`);

let connection;
try {
  connection = await pool.getConnection();
  const [[database]] = await connection.query(
    "SELECT DATABASE() name, @@hostname host, @@port port",
  );
  console.log(
    `Database: ${database.name} on ${database.host}:${database.port}`,
  );
  console.log(apply ? "Mode: APPLY" : "Mode: PREVIEW (no changes)");
  await connection.beginTransaction();
  const [pending] = await connection.query(
    `SELECT p.id, p.account_type, p.school_id, p.account_name,
            p.encrypted_password, p.password_iv, p.password_auth_tag,
            s.id AS student_id
       FROM pending_account_imports p
       LEFT JOIN students s ON CONVERT(s.student_id USING utf8mb4) COLLATE utf8mb4_unicode_ci=CONVERT(p.school_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
      ORDER BY p.id${apply ? " FOR UPDATE" : ""}`,
  );
  const counts = {
    linked: 0,
    ready: 0,
    unmatched: 0,
    existing: 0,
    conflict: 0,
    invalid: 0,
  };
  for (const row of pending) {
    const type = types[row.account_type];
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
    if (!row.student_id) {
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
      [row.student_id, row.account_name],
    );
    if (
      existing.some(
        (account) => String(account.student_id) === String(row.student_id),
      )
    ) {
      counts.existing++;
      continue;
    }
    if (existing.length) {
      counts.conflict++;
      continue;
    }
    if (!apply) {
      counts.ready++;
      continue;
    }
    try {
      await connection.execute(
        `INSERT INTO ${type.table} (student_id, ${type.column}, encrypted_password, password_iv, password_auth_tag, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
        [
          row.student_id,
          row.account_name,
          row.encrypted_password,
          row.password_iv,
          row.password_auth_tag,
        ],
      );
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") throw error;
      counts.conflict++;
      continue;
    }
    await connection.execute("DELETE FROM pending_account_imports WHERE id=?", [
      row.id,
    ]);
    counts.linked++;
  }
  if (apply) await connection.commit();
  else await connection.rollback();
  console.log(JSON.stringify(counts, null, 2));
  console.log(
    "Existing, conflicting, unmatched, and invalid pending records are retained for review.",
  );
} catch (error) {
  if (connection) await connection.rollback();
  console.error(
    "Rematch failed; no changes were committed:",
    error.code || error.message,
  );
  process.exitCode = 1;
} finally {
  connection?.release();
  await pool.end();
}
