import { pool } from "../config/db.js";

export async function ensureCredentialRequestControlsSchema(executor = pool) {
  const [rows] = await executor.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credential_module_controls' AND COLUMN_NAME IN ('accept_password_resets', 'accept_account_requests')",
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  for (const column of ["accept_password_resets", "accept_account_requests"]) {
    if (existing.has(column)) continue;
    try {
      await executor.query(
        `ALTER TABLE credential_module_controls ADD COLUMN ${column} BOOLEAN NOT NULL DEFAULT TRUE`,
      );
      if (column === "accept_password_resets") {
        // Preserve the old setting once during upgrade. Future changes use
        // only the individual credential switches, even if the legacy row remains.
        await executor.query(
          "UPDATE credential_module_controls current_control JOIN credential_module_controls legacy ON legacy.module_key='PASSWORD_RESET_REQUEST' SET current_control.accept_password_resets=legacy.is_visible WHERE current_control.module_key IN ('EMAIL','KUMOSOFT','SCHOOLOGY')",
        );
      }
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}
