// Use the caller's transaction so course changes and SATP status commit together.
// Keep the credentials for history; never automatically reactivate old accounts.
export async function deactivateGraduateSatp(connection, { studentId, courseId } = {}) {
  const filters = ["c.academic_level='GRADUATE_SCHOOL'", "a.is_active=1"];
  const values = [];
  if (studentId !== undefined) {
    filters.push("s.id=?");
    values.push(studentId);
  }
  if (courseId !== undefined) {
    filters.push("s.course_id=?");
    values.push(courseId);
  }
  const [result] = await connection.execute(
    `UPDATE satp_accounts a
     JOIN students s ON s.id=a.student_id
     JOIN courses c ON c.id=s.course_id
     SET a.is_active=0 WHERE ${filters.join(" AND ")}`,
    values,
  );
  return result.affectedRows;
}
