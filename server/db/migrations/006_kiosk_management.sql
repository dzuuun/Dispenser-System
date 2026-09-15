ALTER TABLE kiosks
  ADD COLUMN ip_address VARCHAR(64) NULL AFTER last_seen,
  ADD COLUMN hostname VARCHAR(255) NULL AFTER ip_address,
  ADD COLUMN uptime_seconds BIGINT UNSIGNED NULL AFTER hostname,
  ADD COLUMN browser_status VARCHAR(40) NULL AFTER uptime_seconds,
  ADD COLUMN current_page VARCHAR(500) NULL AFTER browser_status,
  ADD COLUMN mac_address VARCHAR(32) NULL AFTER current_page,
  ADD COLUMN operating_system VARCHAR(160) NULL AFTER mac_address;

CREATE TABLE IF NOT EXISTS kiosk_commands (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  kiosk_id BIGINT UNSIGNED NOT NULL,
  command VARCHAR(40) NOT NULL,
  channel ENUM('BROWSER', 'AGENT') NOT NULL DEFAULT 'BROWSER',
  status ENUM('QUEUED', 'DISPATCHED', 'COMPLETED', 'FAILED', 'UNSUPPORTED') NOT NULL DEFAULT 'QUEUED',
  result_text VARCHAR(1000) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dispatched_at DATETIME NULL,
  completed_at DATETIME NULL,
  INDEX kiosk_command_poll (kiosk_id, channel, status, id),
  CONSTRAINT kiosk_commands_kiosk_fk FOREIGN KEY (kiosk_id) REFERENCES kiosks(id) ON DELETE CASCADE
);
