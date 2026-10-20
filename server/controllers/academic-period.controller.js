import { pool } from "../config/db.js";

const parsePeriod = (body) => {
  const schoolYear = String(body?.schoolYear || "").trim();
  const semester = String(body?.semester || "").trim();
  if (!/^\d{4}-\d{4}$/.test(schoolYear) || !semester)
    throw Object.assign(
      new Error("Enter a school year in YYYY-YYYY format and a semester."),
      { status: 400 },
    );
  return { schoolYear, semester };
};

export async function listAcademicPeriods(_req, res) {
  const [rows] = await pool.query(
    `SELECT p.id, p.school_year schoolYear, p.semester, p.is_current isCurrent,
            p.is_active isActive,
            (SELECT COUNT(*) FROM students s WHERE s.academic_period_id=p.id) studentCount,
            (SELECT COUNT(*) FROM wifi_vouchers w WHERE w.academic_period_id=p.id) voucherCount
       FROM academic_periods p
      ORDER BY p.is_current DESC, p.school_year DESC, p.id DESC`,
  );
  res.json(rows);
}

export async function createAcademicPeriod(req, res) {
  const { schoolYear, semester } = parsePeriod(req.body);
  const adoptUnassigned = req.body?.adoptUnassigned === true;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute(
      "INSERT INTO academic_periods (school_year, semester, is_current, is_active) VALUES (?, ?, 0, 1)",
      [schoolYear, semester],
    );
    if (adoptUnassigned) {
      await connection.execute(
        "UPDATE students SET academic_period_id=? WHERE academic_period_id IS NULL",
        [created.insertId],
      );
      await connection.execute(
        "UPDATE wifi_vouchers SET academic_period_id=? WHERE academic_period_id IS NULL",
        [created.insertId],
      );
    }
    await connection.commit();
    res.status(201).json({ id: created.insertId, schoolYear, semester });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That academic period already exists." });
    throw error;
  } finally {
    connection.release();
  }
}

export async function activateAcademicPeriod(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "Invalid academic period." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[period]] = await connection.execute(
      "SELECT id, school_year schoolYear, semester FROM academic_periods WHERE id=? FOR UPDATE",
      [id],
    );
    if (!period) {
      await connection.rollback();
      return res.status(404).json({ message: "Academic period not found." });
    }
    await connection.query("UPDATE academic_periods SET is_current=0");
    await connection.execute(
      "UPDATE academic_periods SET is_current=1, is_active=1 WHERE id=?",
      [id],
    );
    // Records created before academic periods existed have no period. Adopt
    // them when the administrator establishes a current period so they remain
    // visible and usable after the migration.
    await connection.execute(
      "UPDATE students SET academic_period_id=? WHERE academic_period_id IS NULL",
      [id],
    );
    await connection.execute(
      "UPDATE wifi_vouchers SET academic_period_id=? WHERE academic_period_id IS NULL",
      [id],
    );
    await connection.commit();
    res.json({
      ...period,
      isCurrent: true,
      message: `${period.schoolYear} · ${period.semester} is now active.`,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateAcademicPeriod(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "Invalid academic period." });
  const { schoolYear, semester } = parsePeriod(req.body);
  const setCurrent = req.body?.isCurrent === true;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [updated] = await connection.execute(
      "UPDATE academic_periods SET school_year=?, semester=?, is_active=1 WHERE id=?",
      [schoolYear, semester, id],
    );
    if (!updated.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: "Academic period not found." });
    }
    if (setCurrent) {
      await connection.query("UPDATE academic_periods SET is_current=0");
      await connection.execute(
        "UPDATE academic_periods SET is_current=1 WHERE id=?",
        [id],
      );
      await connection.execute(
        "UPDATE students SET academic_period_id=? WHERE academic_period_id IS NULL",
        [id],
      );
      await connection.execute(
        "UPDATE wifi_vouchers SET academic_period_id=? WHERE academic_period_id IS NULL",
        [id],
      );
    }
    await connection.commit();
    res.json({ id, schoolYear, semester, isCurrent: setCurrent });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That academic period already exists." });
    throw error;
  } finally {
    connection.release();
  }
}
