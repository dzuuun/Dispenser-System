import { pool } from "../config/db.js";

await pool.query(`CREATE TABLE IF NOT EXISTS admin_refresh_sessions (
  id CHAR(36) PRIMARY KEY,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  last_used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_session_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  INDEX refresh_session_active (admin_user_id, revoked_at, expires_at)
)`);
console.log("Security hardening migration completed.");
await pool.end();
