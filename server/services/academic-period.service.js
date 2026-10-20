import { pool } from "../config/db.js";

export async function currentAcademicPeriod(executor = pool) {
  const [[period]] = await executor.query(
    `SELECT id, school_year, semester
       FROM academic_periods
      WHERE is_current=1 AND is_active=1
      ORDER BY id DESC
      LIMIT 1`,
  );
  return period || null;
}

export async function requireCurrentAcademicPeriod(executor = pool) {
  const period = await currentAcademicPeriod(executor);
  if (period) return period;
  throw Object.assign(
    new Error(
      "Set an active school year and semester before managing students or vouchers.",
    ),
    { status: 409 },
  );
}
