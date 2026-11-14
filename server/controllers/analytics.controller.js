import { pool } from "../config/db.js";
import { currentAcademicPeriod } from "../services/academic-period.service.js";
import { requestPermissionFilter } from "../../shared/request-permissions.mjs";

export async function analytics(req, res) {
  const days = req.query.days === undefined ? 30 : Number(req.query.days);
  if (![7, 30, 90].includes(days))
    return res.status(400).json({ message: "Choose 7, 30, or 90 days." });
  const period = await currentAcademicPeriod();
  const periodId = period?.id || 0;
  const filter = requestPermissionFilter(req.admin?.requestPermissions || []);
  const [
    studentResult,
    courseResult,
    activityResult,
    kioskResult,
    requestResult,
    dailyKioskResult,
    kioskDirectoryResult,
    todayResult,
  ] = await Promise.all([
    pool.execute(
      "SELECT COUNT(*) total, COALESCE(SUM(EXISTS (SELECT 1 FROM wifi_vouchers w WHERE w.id=students.voucher_id AND w.academic_period_id=students.academic_period_id AND w.is_active=1 AND w.is_released=0)), 0) with_voucher FROM students WHERE is_active=1 AND academic_period_id=?",
      [periodId],
    ),
    pool.execute(
      "SELECT c.code, c.name, COUNT(*) total FROM students s JOIN courses c ON c.id=s.course_id WHERE s.is_active=1 AND s.academic_period_id=? GROUP BY c.id, c.code, c.name ORDER BY total DESC, c.code LIMIT 8",
      [periodId],
    ),
    pool.execute(
      "SELECT DATE_FORMAT(t.created_at, '%Y-%m-%d') day, COUNT(*) total, COUNT(DISTINCT t.student_id) students FROM credential_transactions t WHERE t.academic_period_id=? AND t.transaction_type='VIEW_CREDENTIALS' AND t.success=1 AND t.created_at>=DATE_SUB(CURDATE(), INTERVAL ? DAY) AND t.created_at<DATE_ADD(CURDATE(), INTERVAL 1 DAY) GROUP BY day ORDER BY day",
      [periodId, days - 1],
    ),
    pool.execute(
      "SELECT COALESCE(NULLIF(TRIM(k.location), ''), 'Unassigned') location, COUNT(*) total FROM credential_transactions t LEFT JOIN kiosks k ON k.kiosk_code=t.kiosk_code WHERE t.academic_period_id=? AND t.transaction_type='VIEW_CREDENTIALS' AND t.success=1 AND t.created_at>=DATE_SUB(CURDATE(), INTERVAL ? DAY) AND t.created_at<DATE_ADD(CURDATE(), INTERVAL 1 DAY) GROUP BY 1 ORDER BY total DESC, location LIMIT 8",
      [periodId, days - 1],
    ),
    pool.execute(
      `SELECT pr.credential_type, pr.status, COUNT(*) total FROM password_reset_requests pr WHERE pr.requested_at>=DATE_SUB(CURDATE(), INTERVAL ? DAY) AND pr.requested_at<DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND ${filter.sql} GROUP BY pr.credential_type, pr.status ORDER BY pr.credential_type, pr.status`,
      [days - 1, ...filter.values],
    ),
    pool.execute(
      "SELECT DATE_FORMAT(t.created_at, '%Y-%m-%d') day, COALESCE(NULLIF(TRIM(t.kiosk_code), ''), '') kiosk_code, COALESCE(NULLIF(TRIM(k.kiosk_name), ''), NULLIF(TRIM(t.kiosk_code), ''), 'Unknown kiosk') kiosk_name, COALESCE(NULLIF(TRIM(k.location), ''), 'Unassigned') location, COUNT(*) total, COUNT(DISTINCT t.student_id) students FROM credential_transactions t LEFT JOIN kiosks k ON k.kiosk_code=t.kiosk_code WHERE t.academic_period_id=? AND t.transaction_type='VIEW_CREDENTIALS' AND t.success=1 AND t.created_at>=DATE_SUB(CURDATE(), INTERVAL ? DAY) AND t.created_at<DATE_ADD(CURDATE(), INTERVAL 1 DAY) GROUP BY 1, 2, 3, 4 ORDER BY day, kiosk_name, kiosk_code",
      [periodId, days - 1],
    ),
    pool.query(
      "SELECT kiosk_code, kiosk_name, COALESCE(NULLIF(TRIM(location), ''), 'Unassigned') location FROM kiosks ORDER BY kiosk_name, kiosk_code",
    ),
    pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') today"),
  ]);
  res.set("Cache-Control", "no-store").json({
    days,
    academicPeriod: period
      ? {
          id: period.id,
          schoolYear: period.school_year,
          semester: period.semester,
        }
      : null,
    students: studentResult[0][0],
    courses: courseResult[0],
    activity: activityResult[0],
    kiosks: kioskResult[0],
    requests: requestResult[0],
    dailyKiosks: dailyKioskResult[0],
    kioskDirectory: kioskDirectoryResult[0],
    today: todayResult[0][0].today,
  });
}
