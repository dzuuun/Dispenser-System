import { pool } from "../config/db.js";
export async function transaction({
  studentId = null,
  kioskCode = null,
  type,
  success,
  ip,
  userAgent,
  academicPeriodId = null,
}) {
  let periodId = academicPeriodId;
  if (!periodId && studentId) {
    const [[student]] = await pool.execute(
      "SELECT academic_period_id FROM students WHERE id=?",
      [studentId],
    );
    periodId = student?.academic_period_id || null;
  }
  await pool.execute(
    "INSERT INTO credential_transactions (student_id, academic_period_id, kiosk_code, transaction_type, success, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      studentId,
      periodId,
      kioskCode,
      type,
      success,
      ip,
      userAgent?.slice(0, 255) || null,
    ],
  );
}

export async function auditAdminAction({
  req,
  action,
  module,
  recordId = null,
  description = null,
}) {
  if (!req.admin?.sub) return;
  const ip = req.ip?.replace(/^::ffff:/, "") || null;
  await pool.execute(
    "INSERT INTO audit_logs (admin_user_id, action, module, record_id, description, ip_address) VALUES (?, ?, ?, ?, ?, ?)",
    [
      req.admin.sub,
      action,
      module,
      recordId ? String(recordId) : null,
      description,
      ip,
    ],
  );
}

export const auditAdminMutation = (action, module) => (req, res, next) => {
  res.once("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300)
      auditAdminAction({
        req,
        action,
        module,
        recordId: req.params.id || req.params.module || null,
      }).catch((error) =>
        console.error("Audit logging failed:", error.message),
      );
  });
  next();
};
