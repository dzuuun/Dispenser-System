import { pool } from "../config/db.js";

const [[column]] = await pool.query(
  "SHOW COLUMNS FROM password_reset_requests LIKE 'request_kind'",
);
if (!column)
  await pool.query(
    "ALTER TABLE password_reset_requests ADD COLUMN request_kind ENUM('PASSWORD_RESET','ACCOUNT_CREATION') NOT NULL DEFAULT 'PASSWORD_RESET' AFTER credential_type",
  );
const [[pendingKey]] = await pool.query(
  "SHOW COLUMNS FROM password_reset_requests LIKE 'pending_key'",
);
if (!pendingKey)
  await pool.query(
    "ALTER TABLE password_reset_requests ADD COLUMN pending_key VARCHAR(120) GENERATED ALWAYS AS (IF(status='PENDING', CONCAT(student_id, '-', credential_type, '-', request_kind), NULL)) STORED, ADD UNIQUE KEY one_pending_credential_request (pending_key)",
  );
console.log("Credential account request schema applied.");
await pool.end();
