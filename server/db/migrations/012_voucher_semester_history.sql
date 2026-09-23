CREATE TABLE academic_periods (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_year VARCHAR(20) NOT NULL,
  semester VARCHAR(30) NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY academic_period (school_year, semester)
);

ALTER TABLE wifi_vouchers ADD COLUMN academic_period_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_voucher_period FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id),
  ADD INDEX voucher_period_stock (academic_period_id, is_active, is_assigned, is_released);

CREATE TABLE voucher_assignment_history (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL,
  voucher_id BIGINT UNSIGNED NOT NULL,
  academic_period_id BIGINT UNSIGNED NULL,
  voucher_code VARCHAR(255) NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at DATETIME NULL,
  release_reason VARCHAR(80) NULL,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (voucher_id) REFERENCES wifi_vouchers(id),
  FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id),
  INDEX student_voucher_history (student_id, assigned_at DESC)
);
