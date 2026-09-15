import { pool } from "../config/db.js";
import { encryptPassword } from "../services/encryption.service.js";

const students = [
  [
    "DEMO-2026-001",
    "Alana",
    "Santos",
    "Mae",
    "2004-02-14",
    "demo.alana@ndmu.edu.ph",
  ],
  [
    "DEMO-2026-002",
    "Brian",
    "Cruz",
    "Lopez",
    "2003-06-21",
    "demo.brian@ndmu.edu.ph",
  ],
  [
    "DEMO-2026-003",
    "Carla",
    "Reyes",
    "Diaz",
    "2004-09-08",
    "demo.carla@ndmu.edu.ph",
  ],
  [
    "DEMO-2026-004",
    "Diego",
    "Garcia",
    "Ramos",
    "2003-11-30",
    "demo.diego@ndmu.edu.ph",
  ],
  [
    "DEMO-2026-005",
    "Elise",
    "Mendoza",
    "Torres",
    "2004-04-17",
    "demo.elise@ndmu.edu.ph",
  ],
];

const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  let [[course]] = await connection.query(
    "SELECT id FROM courses WHERE is_active=1 ORDER BY id LIMIT 1",
  );
  if (!course) {
    const [created] = await connection.execute(
      "INSERT INTO courses (code, name, is_active) VALUES (?, ?, 1)",
      ["DEMO", "Demo Course"],
    );
    course = { id: created.insertId };
  }
  for (let index = 0; index < students.length; index++) {
    const [studentId, firstName, lastName, middleName, birthDate, email] =
      students[index];
    const [saved] = await connection.execute(
      "INSERT INTO students (student_id, first_name, middle_name, last_name, birth_date, course_id, year_level, is_active) VALUES (?, ?, ?, ?, ?, ?, NULL, 1) ON DUPLICATE KEY UPDATE first_name=VALUES(first_name), middle_name=VALUES(middle_name), last_name=VALUES(last_name), birth_date=VALUES(birth_date), course_id=VALUES(course_id), is_active=1",
      [studentId, firstName, middleName, lastName, birthDate, course.id],
    );
    const [[student]] = await connection.execute(
      "SELECT id FROM students WHERE student_id=?",
      [studentId],
    );
    const password = `Demo${index + 1}!Pass`;
    const saveAccount = async (table, login, emailAccount = false) => {
      const encrypted = encryptPassword(password);
      const column = emailAccount ? "email_address" : "username";
      await connection.execute(
        `INSERT INTO ${table} (student_id, ${column}, encrypted_password, password_iv, password_auth_tag, is_active) VALUES (?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE ${column}=VALUES(${column}), encrypted_password=VALUES(encrypted_password), password_iv=VALUES(password_iv), password_auth_tag=VALUES(password_auth_tag), is_active=1`,
        [
          student.id,
          login,
          encrypted.encrypted_password,
          encrypted.password_iv,
          encrypted.password_auth_tag,
        ],
      );
    };
    await saveAccount("satp_accounts", studentId);
    await saveAccount("schoology_accounts", studentId);
    await saveAccount("kumosoft_accounts", studentId);
    await saveAccount("institutional_email_accounts", email, true);
    const voucherCode = `DEMO-WIFI-${String(index + 1).padStart(3, "0")}`;
    await connection.execute(
      "INSERT INTO wifi_vouchers (voucher_code, is_assigned, assigned_at) VALUES (?, 1, NOW()) ON DUPLICATE KEY UPDATE is_assigned=1, is_released=0, assigned_at=NOW(), released_at=NULL",
      [voucherCode],
    );
    const [[voucher]] = await connection.execute(
      "SELECT id FROM wifi_vouchers WHERE voucher_code=?",
      [voucherCode],
    );
    await connection.execute("UPDATE students SET voucher_id=? WHERE id=?", [
      voucher.id,
      student.id,
    ]);
    console.log(`${saved.affectedRows ? "Seeded" : "Updated"} ${studentId}`);
  }
  await connection.commit();
  console.log(
    "Five dummy students were seeded. Passwords: Demo1!Pass through Demo5!Pass.",
  );
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await pool.end();
}
