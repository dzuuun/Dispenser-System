import { pool } from "../config/db.js";

await pool.query(
  "ALTER TABLE password_reset_requests MODIFY COLUMN credential_type ENUM('SATP','SCHOOLOGY','KUMOSOFT','EMAIL','VOUCHER') NOT NULL",
);
await pool.query(
  "ALTER TABLE password_reset_requests MODIFY COLUMN request_kind ENUM('PASSWORD_RESET','ACCOUNT_CREATION','VOUCHER_REQUEST') NOT NULL DEFAULT 'PASSWORD_RESET'",
);
await pool.query(
  "ALTER TABLE password_reset_requests MODIFY COLUMN status ENUM('PENDING','COMPLETED','REJECTED') NOT NULL DEFAULT 'PENDING'",
);
const [[reasonColumn]] = await pool.query(
  "SHOW COLUMNS FROM password_reset_requests LIKE 'request_reason'",
);
if (!reasonColumn)
  await pool.query(
    "ALTER TABLE password_reset_requests ADD COLUMN request_reason VARCHAR(500) NULL AFTER request_kind",
  );

console.log("Voucher request schema applied.");
await pool.end();
