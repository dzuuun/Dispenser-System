import { pool } from "../config/db.js";

export async function dashboard(_req, res) {
  const [[students], [vouchers], [transactions], [kiosks], credentials] =
    await Promise.all([
      pool.query("SELECT COUNT(*) total FROM students WHERE is_active=1"),
      pool.query(
        "SELECT SUM(is_active=1 AND is_assigned=0 AND is_released=0) available, SUM(is_active=1 AND is_assigned=1) assigned FROM wifi_vouchers",
      ),
      pool.query(
        "SELECT transaction_type, success, created_at FROM credential_transactions WHERE transaction_type='VIEW_CREDENTIALS' AND success=1 ORDER BY created_at DESC, id DESC LIMIT 10",
      ),
      pool.query(
        "SELECT COUNT(*) total, SUM(is_active=1 AND last_seen >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)) online FROM kiosks",
      ),
      pool.query(
        "SELECT 'SATP' credential_type, COUNT(*) total FROM satp_accounts WHERE is_active=1 UNION ALL SELECT 'SCHOOLOGY', COUNT(*) FROM schoology_accounts WHERE is_active=1 UNION ALL SELECT 'KUMOSOFT', COUNT(*) FROM kumosoft_accounts WHERE is_active=1 UNION ALL SELECT 'EMAIL', COUNT(*) FROM institutional_email_accounts WHERE is_active=1",
      ),
    ]);
  res.json({
    activeStudents: students[0].total,
    vouchers: {
      available: Number(vouchers[0].available || 0),
      assigned: Number(vouchers[0].assigned || 0),
    },
    kiosks: {
      total: Number(kiosks[0].total || 0),
      online: Number(kiosks[0].online || 0),
    },
    credentials: Array.isArray(credentials[0]) ? credentials[0] : [],
    recentActivity: Array.isArray(transactions[0]) ? transactions[0] : [],
  });
}

export async function listTransactions(_req, res) {
  const [rows] = await pool.query(
    `SELECT t.id, t.transaction_type, t.success, t.kiosk_code,
            t.ip_address, t.created_at, s.student_id,
            s.first_name, s.middle_name, s.last_name
       FROM credential_transactions t
       LEFT JOIN students s ON s.id=t.student_id
      WHERE t.transaction_type='VIEW_CREDENTIALS' AND t.success=1
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 1000`,
  );
  res.set("Cache-Control", "no-store").json(rows);
}
