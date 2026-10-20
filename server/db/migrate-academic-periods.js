import { pool } from "../config/db.js";

async function hasColumn(table, column) {
  const [[row]] = await pool.execute(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`,
    [table, column],
  );
  return Boolean(row);
}

await pool.query(`CREATE TABLE IF NOT EXISTS academic_periods (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_year VARCHAR(20) NOT NULL,
  semester VARCHAR(30) NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY academic_period (school_year, semester),
  INDEX current_period (is_current, is_active)
)`);
for (const table of ["students", "wifi_vouchers"]) {
  if (!(await hasColumn(table, "academic_period_id"))) {
    await pool.query(`ALTER TABLE \`${table}\`
      ADD COLUMN academic_period_id BIGINT UNSIGNED NULL,
      ADD INDEX \`${table}_academic_period\` (academic_period_id),
      ADD CONSTRAINT \`fk_${table}_academic_period\`
        FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id)`);
  }
}
if (!(await hasColumn("credential_transactions", "academic_period_id"))) {
  await pool.query(`ALTER TABLE credential_transactions
    ADD COLUMN academic_period_id BIGINT UNSIGNED NULL,
    ADD INDEX transaction_academic_period (academic_period_id, created_at),
    ADD CONSTRAINT fk_transactions_academic_period
      FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id)`);
}
const [[current]] = await pool.query(
  "SELECT id FROM academic_periods WHERE is_current=1 AND is_active=1 LIMIT 1",
);
if (current)
  await pool.execute(
    `UPDATE credential_transactions t LEFT JOIN students s ON s.id=t.student_id
        SET t.academic_period_id=COALESCE(s.academic_period_id, ?)
      WHERE t.academic_period_id IS NULL`,
    [current.id],
  );
console.log(
  "Academic-period schema is ready. Create and activate a period from Administration > Academic periods.",
);
await pool.end();
