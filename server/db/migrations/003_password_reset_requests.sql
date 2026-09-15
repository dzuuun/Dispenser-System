CREATE TABLE IF NOT EXISTS password_reset_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL,
  credential_type ENUM('SATP', 'SCHOOLOGY', 'KUMOSOFT', 'EMAIL', 'VOUCHER') NOT NULL,
  request_kind ENUM('PASSWORD_RESET', 'ACCOUNT_CREATION', 'VOUCHER_REQUEST') NOT NULL DEFAULT 'PASSWORD_RESET',
  request_reason VARCHAR(500) NULL,
  status ENUM('PENDING', 'COMPLETED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  kiosk_code VARCHAR(80) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  resolved_by BIGINT UNSIGNED NULL,
  pending_key VARCHAR(120) GENERATED ALWAYS AS (IF(status='PENDING', CONCAT(student_id, '-', credential_type, '-', request_kind), NULL)) STORED,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (resolved_by) REFERENCES admin_users(id),
  INDEX reset_request_queue (status, requested_at),
  INDEX student_reset_requests (student_id, credential_type, status),
  UNIQUE KEY one_pending_credential_request (pending_key)
);
