CREATE TABLE IF NOT EXISTS kiosk_credential_sessions (
  id CHAR(36) PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX kiosk_credential_session_expiry (expires_at),
  CONSTRAINT kiosk_credential_sessions_student_fk
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
