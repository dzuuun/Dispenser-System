-- NDMU Credentials Dispenser: canonical development database.
-- This is intentionally destructive. It replaces every development record.

DROP DATABASE IF EXISTS `ndmu_credentials`;
CREATE DATABASE `ndmu_credentials`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE `ndmu_credentials`;

CREATE TABLE roles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  request_permissions JSON NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE admin_refresh_sessions (
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
);

CREATE TABLE courses (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  academic_level ENUM('COLLEGE', 'GRADUATE_SCHOOL', 'OTHER') NOT NULL DEFAULT 'OTHER',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE academic_periods (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_year VARCHAR(20) NOT NULL,
  semester VARCHAR(30) NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY academic_period (school_year, semester),
  INDEX current_period (is_current, is_active)
);

CREATE TABLE wifi_vouchers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  voucher_code VARCHAR(255) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_assigned BOOLEAN NOT NULL DEFAULT FALSE,
  is_released BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_at DATETIME NULL,
  released_at DATETIME NULL,
  academic_period_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX available_voucher (is_active, is_assigned, is_released),
  INDEX voucher_period_list (academic_period_id, voucher_code, id),
  INDEX released_voucher (is_released, released_at)
  ,CONSTRAINT fk_vouchers_academic_period FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id)
);

CREATE TABLE students (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id VARCHAR(40) NOT NULL UNIQUE,
  kumosoft_id VARCHAR(40) NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NOT NULL,
  birth_date DATE NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  voucher_id BIGINT UNSIGNED NULL UNIQUE,
  academic_period_id BIGINT UNSIGNED NULL,
  year_level TINYINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_course FOREIGN KEY (course_id) REFERENCES courses(id),
  CONSTRAINT fk_students_voucher FOREIGN KEY (voucher_id) REFERENCES wifi_vouchers(id),
  CONSTRAINT fk_students_academic_period FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id),
  INDEX student_verification (student_id, last_name, birth_date, course_id, is_active),
  INDEX student_academic_period (academic_period_id, is_active),
  INDEX student_course_status (course_id, is_active, last_name, first_name),
  INDEX student_list_sort (is_active, last_name, first_name, id),
  INDEX student_name_search (last_name, first_name)
);

-- Each external service remains a separate bounded module. Its account data is
-- one-to-one with a student and has no duplicated student identity fields.
CREATE TABLE satp_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL UNIQUE,
  username VARCHAR(255) NOT NULL,
  encrypted_password TEXT NOT NULL,
  password_iv VARCHAR(50) NOT NULL,
  password_auth_tag VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_satp_student FOREIGN KEY (student_id) REFERENCES students(id),
  UNIQUE KEY unique_satp_username (username)
);

CREATE TABLE schoology_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL UNIQUE,
  username VARCHAR(255) NOT NULL,
  encrypted_password TEXT NOT NULL,
  password_iv VARCHAR(50) NOT NULL,
  password_auth_tag VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_schoology_student FOREIGN KEY (student_id) REFERENCES students(id),
  UNIQUE KEY unique_schoology_username (username)
);

CREATE TABLE kumosoft_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL UNIQUE,
  username VARCHAR(255) NOT NULL,
  encrypted_password TEXT NULL,
  password_iv VARCHAR(50) NULL,
  password_auth_tag VARCHAR(50) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_kumosoft_student FOREIGN KEY (student_id) REFERENCES students(id),
  UNIQUE KEY unique_kumosoft_username (username)
);

CREATE TABLE institutional_email_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL UNIQUE,
  email_address VARCHAR(255) NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL,
  password_iv VARCHAR(50) NOT NULL,
  password_auth_tag VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_email_student FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE pending_account_imports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account_type VARCHAR(30) NOT NULL,
  school_id VARCHAR(40) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  encrypted_password TEXT NULL,
  password_iv VARCHAR(50) NULL,
  password_auth_tag VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY pending_account_identity (account_type, school_id)
);

CREATE TABLE kiosks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  kiosk_code VARCHAR(80) NOT NULL UNIQUE,
  kiosk_name VARCHAR(120) NOT NULL,
  location VARCHAR(160) NULL,
  secret_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen DATETIME NULL,
  ip_address VARCHAR(64) NULL,
  hostname VARCHAR(255) NULL,
  uptime_seconds BIGINT UNSIGNED NULL,
  browser_status VARCHAR(40) NULL,
  current_page VARCHAR(500) NULL,
  mac_address VARCHAR(32) NULL,
  operating_system VARCHAR(160) NULL,
  activity_state VARCHAR(24) NULL,
  activity_reported_at DATETIME NULL,
  last_interaction_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX kiosk_heartbeat (is_active, last_seen)
);

CREATE TABLE kiosk_credential_sessions (
  id CHAR(36) PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX kiosk_credential_session_expiry (expires_at),
  CONSTRAINT fk_kiosk_credential_sessions_student
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE kiosk_commands (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  kiosk_id BIGINT UNSIGNED NOT NULL,
  command VARCHAR(40) NOT NULL,
  channel ENUM('BROWSER', 'AGENT') NOT NULL DEFAULT 'BROWSER',
  status ENUM('QUEUED', 'DISPATCHED', 'COMPLETED', 'FAILED', 'UNSUPPORTED') NOT NULL DEFAULT 'QUEUED',
  result_text VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at DATETIME NULL,
  completed_at DATETIME NULL,
  CONSTRAINT fk_kiosk_commands_kiosk FOREIGN KEY (kiosk_id) REFERENCES kiosks(id) ON DELETE CASCADE,
  INDEX kiosk_command_poll (kiosk_id, channel, status, id)
);

CREATE TABLE credential_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NULL,
  academic_period_id BIGINT UNSIGNED NULL,
  kiosk_code VARCHAR(80) NULL,
  transaction_type ENUM('VERIFY', 'VIEW_CREDENTIALS', 'RELEASE_VOUCHER', 'ASSIGN_VOUCHER') NOT NULL,
  success BOOLEAN NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  CONSTRAINT fk_transactions_academic_period FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id),
  INDEX transaction_academic_period (academic_period_id, created_at),
  INDEX transaction_recent (created_at),
  INDEX transaction_student (student_id, created_at),
  INDEX transaction_kiosk (kiosk_code, created_at)
);

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  module VARCHAR(80) NOT NULL,
  record_id VARCHAR(80) NULL,
  description TEXT NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX audit_recent (created_at),
  INDEX audit_record (module, record_id, created_at)
);

CREATE TABLE password_reset_requests (
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
  CONSTRAINT fk_requests_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_requests_admin FOREIGN KEY (resolved_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  UNIQUE KEY one_pending_credential_request (pending_key),
  INDEX reset_request_queue (status, requested_at),
  INDEX student_reset_requests (student_id, credential_type, status)
);

CREATE TABLE kiosk_reminders (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  placement ENUM('BANNER', 'GUIDELINE', 'TIP') NOT NULL DEFAULT 'GUIDELINE',
  title VARCHAR(160) NOT NULL,
  message VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX active_reminders (is_active, placement, sort_order)
);

CREATE TABLE credential_module_controls (
  module_key ENUM('VOUCHER', 'SATP', 'SCHOOLOGY', 'KUMOSOFT', 'EMAIL', 'PASSWORD_RESET_REQUEST', 'KIOSK') PRIMARY KEY,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  is_maintenance BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO credential_module_controls (module_key) VALUES
  ('VOUCHER'), ('SATP'), ('SCHOOLOGY'), ('KUMOSOFT'), ('EMAIL'), ('PASSWORD_RESET_REQUEST'), ('KIOSK');

INSERT INTO kiosk_reminders (placement, title, message, sort_order) VALUES
  ('BANNER', 'Use your correct Course, Last Name, and Birthday.', 'Your information must match the records.', 10),
  ('GUIDELINE', 'For enrolled NDMU students only.', 'Credential and voucher access is exclusive to enrolled students.', 20),
  ('GUIDELINE', 'One voucher per student.', 'Please use your assigned voucher responsibly.', 30),
  ('GUIDELINE', 'Keep your credentials private.', 'Do not share passwords or voucher codes with anyone.', 40),
  ('GUIDELINE', 'Need help?', 'Submit a password reset request or proceed to the ICT/MIS Office.', 50),
  ('TIP', 'Double-check your information.', 'Confirm your course, last name, and birthday before submitting.', 60);

CREATE TABLE IF NOT EXISTS credential_request_reviews (
  request_id BIGINT UNSIGNED PRIMARY KEY,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  review_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (request_id) REFERENCES password_reset_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);
