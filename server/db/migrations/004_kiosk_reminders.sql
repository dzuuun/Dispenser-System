CREATE TABLE IF NOT EXISTS kiosk_reminders (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  placement ENUM('BANNER', 'GUIDELINE', 'TIP') NOT NULL DEFAULT 'GUIDELINE',
  title VARCHAR(160) NOT NULL,
  message VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX active_reminders (is_active, placement, sort_order)
);

INSERT INTO kiosk_reminders (placement, title, message, sort_order) VALUES
  ('BANNER', 'Use your correct Course, Last Name, and Birthday.', 'Your information must match the records.', 10),
  ('GUIDELINE', 'For enrolled NDMU students only.', 'Credential and voucher access is exclusive to enrolled students.', 20),
  ('GUIDELINE', 'One voucher per student.', 'Please use your assigned voucher responsibly.', 30),
  ('GUIDELINE', 'Keep your credentials private.', 'Do not share passwords or voucher codes with anyone.', 40),
  ('GUIDELINE', 'Need help?', 'Submit a password reset request or proceed to the ICT/MIS Office.', 50),
  ('TIP', 'Double-check your information.', 'Confirm your course, last name, and birthday before submitting.', 60);
