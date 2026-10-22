ALTER TABLE credential_module_controls
  MODIFY module_key ENUM('VOUCHER', 'SATP', 'SCHOOLOGY', 'KUMOSOFT', 'EMAIL', 'PASSWORD_RESET_REQUEST', 'KIOSK') NOT NULL;

INSERT IGNORE INTO credential_module_controls (module_key) VALUES ('PASSWORD_RESET_REQUEST');
