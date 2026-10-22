import { pool } from "../config/db.js";

export async function ensureAdminRequestPermissionsSchema(executor = pool) {
  const [[column]] = await executor.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users' AND COLUMN_NAME='request_permissions'",
  );
  if (!column) {
    try {
      await executor.query(
        "ALTER TABLE admin_users ADD COLUMN request_permissions JSON NULL",
      );
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
  await executor.execute(
    "INSERT IGNORE INTO roles (name, description) VALUES (?, ?)",
    ["Request Staff", "Processes only assigned credential requests"],
  );
}
