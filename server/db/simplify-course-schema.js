import { pool } from "../config/db.js";

const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [foreignKeys] = await connection.query(
    "SELECT constraint_name FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='courses' AND column_name IN ('college_id', 'department_id') AND referenced_table_name IS NOT NULL",
  );
  for (const key of foreignKeys)
    await connection.query(
      `ALTER TABLE courses DROP FOREIGN KEY \`${key.constraint_name}\``,
    );
  const [columns] = await connection.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='courses' AND column_name IN ('college_id', 'department_id')",
  );
  for (const column of columns)
    await connection.query(
      `ALTER TABLE courses DROP COLUMN \`${column.column_name}\``,
    );
  await connection.query("DROP TABLE IF EXISTS departments");
  await connection.query("DROP TABLE IF EXISTS colleges");
  await connection.commit();
  console.log(
    "Course schema simplified: courses is now independent; colleges and departments were removed.",
  );
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
  await pool.end();
}
