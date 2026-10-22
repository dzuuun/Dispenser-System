import { pool } from "../config/db.js";
import { inferAcademicLevel } from "../services/course-level.service.js";

const connection = await pool.getConnection();
try {
  const [columns] = await connection.query("SHOW COLUMNS FROM courses LIKE 'academic_level'");
  if (!columns.length)
    await connection.query("ALTER TABLE courses ADD COLUMN academic_level ENUM('COLLEGE','GRADUATE_SCHOOL','OTHER') NULL DEFAULT NULL AFTER name");
  await connection.beginTransaction();
  const [courses] = await connection.query("SELECT id, code, name FROM courses WHERE academic_level IS NULL");
  for (const course of courses)
    await connection.execute("UPDATE courses SET academic_level=? WHERE id=? AND academic_level IS NULL", [inferAcademicLevel(course.code, course.name), course.id]);
  await connection.commit();
  if (!columns.length || columns[0].Null === "YES" || columns[0].Default !== "OTHER")
    await connection.query("ALTER TABLE courses MODIFY academic_level ENUM('COLLEGE','GRADUATE_SCHOOL','OTHER') NOT NULL DEFAULT 'OTHER'");
  const [summary] = await connection.query("SELECT academic_level, COUNT(*) AS courses FROM courses GROUP BY academic_level");
  console.table(summary);
  console.log("Course levels applied. Review Other courses in Admin > Courses. Only College courses receive SATP.");
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await pool.end();
}
