import { pool } from "../config/db.js";

const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [[voucherIdColumn]] = await connection.query(
    "SHOW COLUMNS FROM students LIKE 'voucher_id'",
  );
  if (!voucherIdColumn)
    await connection.query(
      "ALTER TABLE students ADD COLUMN voucher_id BIGINT UNSIGNED NULL UNIQUE AFTER course_id",
    );
  const [[studentIdColumn]] = await connection.query(
    "SHOW COLUMNS FROM wifi_vouchers LIKE 'student_id'",
  );
  if (studentIdColumn)
    await connection.query(
      "UPDATE students s JOIN wifi_vouchers w ON w.student_id=s.id SET s.voucher_id=w.id WHERE s.voucher_id IS NULL",
    );
  const [foreignKeys] = await connection.query(
    "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wifi_vouchers' AND COLUMN_NAME IN ('student_id','academic_period_id') AND REFERENCED_TABLE_NAME IS NOT NULL",
  );
  for (const key of foreignKeys)
    await connection.query(
      `ALTER TABLE wifi_vouchers DROP FOREIGN KEY \`${key.CONSTRAINT_NAME}\``,
    );
  const [[studentIndex]] = await connection.query(
    "SHOW INDEX FROM wifi_vouchers WHERE Key_name='available_voucher'",
  );
  if (studentIndex)
    await connection.query(
      "ALTER TABLE wifi_vouchers DROP INDEX available_voucher",
    );
  const [[academicColumn]] = await connection.query(
    "SHOW COLUMNS FROM wifi_vouchers LIKE 'academic_period_id'",
  );
  if (academicColumn)
    await connection.query(
      "ALTER TABLE wifi_vouchers DROP COLUMN academic_period_id",
    );
  if (studentIdColumn)
    await connection.query("ALTER TABLE wifi_vouchers DROP COLUMN student_id");
  const [voucherIndex] = await connection.query(
    "SHOW INDEX FROM students WHERE Key_name='voucher_id'",
  );
  if (!voucherIndex.length)
    await connection.query(
      "ALTER TABLE students ADD UNIQUE KEY voucher_id (voucher_id)",
    );
  const [studentVoucherFk] = await connection.query(
    "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='students' AND COLUMN_NAME='voucher_id' AND REFERENCED_TABLE_NAME='wifi_vouchers'",
  );
  if (!studentVoucherFk.length)
    await connection.query(
      "ALTER TABLE students ADD CONSTRAINT fk_students_voucher FOREIGN KEY (voucher_id) REFERENCES wifi_vouchers(id)",
    );
  await connection.query(
    "ALTER TABLE wifi_vouchers ADD INDEX available_voucher (is_assigned)",
  );
  await connection.commit();
  console.log("Voucher relationship migrated to students.voucher_id.");
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await pool.end();
}
