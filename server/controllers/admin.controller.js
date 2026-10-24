import { pool } from "../config/db.js";
import { currentAcademicPeriod } from "../services/academic-period.service.js";
import { requestPermissionFilter } from "../../shared/request-permissions.mjs";
import ExcelJS from "exceljs";
import {
  tableSearch,
  dateSearchFields,
} from "../services/table-search.service.js";

const transactionWhere =
  "t.academic_period_id=? AND t.transaction_type='VIEW_CREDENTIALS' AND t.success=1";
const transactionSelect = `SELECT t.id, t.transaction_type, t.success, t.kiosk_code,
  t.ip_address, t.created_at, s.student_id, s.first_name, s.middle_name, s.last_name,
  c.code AS course_code
  FROM credential_transactions t LEFT JOIN students s ON s.id=t.student_id
  LEFT JOIN courses c ON c.id=s.course_id`;

async function transactionPeriod(query) {
  if (query.academicPeriodId === undefined) return currentAcademicPeriod();
  const value = query.academicPeriodId;
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw Object.assign(new Error("Choose a valid academic period."), {
      status: 400,
    });
  }
  // Historical periods remain available even after they have been deactivated.
  const [[period]] = await pool.execute(
    "SELECT id, school_year, semester FROM academic_periods WHERE id=?",
    [Number(value)],
  );
  if (!period)
    throw Object.assign(new Error("Academic period not found."), {
      status: 404,
    });
  return period;
}

export async function transactionAcademicPeriods(req, res) {
  const [periods] = await pool.query(
    `SELECT id, school_year AS schoolYear, semester,
      (is_current=1 AND is_active=1) AS isCurrent
     FROM academic_periods ORDER BY isCurrent DESC, school_year DESC, id DESC`,
  );
  res.set("Cache-Control", "no-store").json(periods);
}

export async function exportTransactions(req, res) {
  const period = await transactionPeriod(req.query);
  if (!period)
    return res.status(404).json({
      message:
        "No current academic period is available. Choose another period.",
    });
  // Export the entire period, regardless of the table's page or page size.
  const [rows] = await pool.execute(
    `${transactionSelect} WHERE ${transactionWhere} ORDER BY t.created_at DESC, t.id DESC`,
    [period.id],
  );
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Transactions");
  sheet.columns = [
    { header: "Transaction ID", key: "id", width: 18 },
    { header: "School year", key: "schoolYear", width: 18 },
    { header: "Semester", key: "semester", width: 24 },
    { header: "Student ID", key: "studentId", width: 18 },
    { header: "Student name", key: "studentName", width: 42 },
    { header: "Kiosk", key: "kiosk", width: 22 },
    { header: "Result", key: "result", width: 16 },
    { header: "Date and time (UTC+08:00)", key: "createdAt", width: 30 },
  ];
  const dateFormat = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (const row of rows)
    sheet.addRow({
      id: row.id,
      schoolYear: period.school_year,
      semester: period.semester,
      studentId: row.student_id || "",
      studentName:
        [row.first_name, row.middle_name, row.last_name]
          .filter(Boolean)
          .join(" ") || "Unknown student",
      kiosk: row.kiosk_code || "",
      result: "Revealed",
      createdAt: row.created_at
        ? dateFormat.format(new Date(row.created_at))
        : "",
    });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "H1" };
  const label = `${period.school_year}-${period.semester}`.replace(
    /[^a-zA-Z0-9-]+/g,
    "-",
  );
  res
    .set({
      "Cache-Control": "no-store",
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="transactions-${label}-${period.id}.xlsx"`,
    })
    .send(Buffer.from(await workbook.xlsx.writeBuffer()));
}

export async function dashboard(req, res) {
  const requestFilter = requestPermissionFilter(
    req.admin?.requestPermissions || [],
  );
  const period = await currentAcademicPeriod();
  const periodId = period?.id || 0;
  const [
    [students],
    [vouchers],
    [transactions],
    [kiosks],
    credentials,
    [requests],
    [courses],
  ] = await Promise.all([
    pool.execute(
      `SELECT COUNT(*) total, COALESCE(SUM(voucher_id IS NULL), 0) withoutVoucher
       FROM students WHERE is_active=1 AND academic_period_id=?`,
      [periodId],
    ),
    pool.query(
      "SELECT SUM(is_active=1 AND is_assigned=0 AND is_released=0) available, SUM(is_active=1 AND is_assigned=1) assigned FROM wifi_vouchers WHERE academic_period_id=?",
      [periodId],
    ),
    pool.query(
      `SELECT t.transaction_type, t.created_at, t.kiosk_code, s.student_id,
                s.first_name, s.middle_name, s.last_name
           FROM credential_transactions t
           LEFT JOIN students s ON s.id=t.student_id
          WHERE t.academic_period_id=? AND t.transaction_type='VIEW_CREDENTIALS' AND t.success=1
          ORDER BY t.created_at DESC, t.id DESC LIMIT 8`,
      [periodId],
    ),
    pool.query(
      "SELECT COUNT(*) total, SUM(is_active=1 AND last_seen >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)) online FROM kiosks",
    ),
    pool.query(
      "SELECT 'SATP' credential_type, COUNT(*) total FROM satp_accounts WHERE is_active=1 UNION ALL SELECT 'SCHOOLOGY', COUNT(*) FROM schoology_accounts WHERE is_active=1 UNION ALL SELECT 'KUMOSOFT', COUNT(*) FROM kumosoft_accounts WHERE is_active=1 UNION ALL SELECT 'EMAIL', COUNT(*) FROM institutional_email_accounts WHERE is_active=1",
    ),
    pool.query(
      `SELECT COUNT(*) total FROM password_reset_requests pr WHERE pr.status='PENDING' AND ${requestFilter.sql}`,
      requestFilter.values,
    ),
    pool.query("SELECT COUNT(*) total FROM courses WHERE is_active=1"),
  ]);
  res.json({
    academicPeriod: period
      ? {
          id: period.id,
          schoolYear: period.school_year,
          semester: period.semester,
        }
      : null,
    activeStudents: students[0].total,
    activeCourses: Number(courses[0].total || 0),
    pendingRequests: Number(requests[0].total || 0),
    vouchers: {
      total:
        Number(vouchers[0].available || 0) + Number(vouchers[0].assigned || 0),
      available: Number(vouchers[0].available || 0),
      assigned: Number(vouchers[0].assigned || 0),
      studentsWithoutVoucher: Number(students[0].withoutVoucher || 0),
    },
    kiosks: {
      total: Number(kiosks[0].total || 0),
      online: Number(kiosks[0].online || 0),
    },
    credentials: Array.isArray(credentials[0]) ? credentials[0] : [],
    recentActivity: Array.isArray(transactions[0]) ? transactions[0] : [],
  });
}

export async function listTransactions(req, res) {
  const search = tableSearch(req.query.search, [
    "s.student_id",
    "CONCAT_WS(' ', NULLIF(s.first_name, ''), NULLIF(s.middle_name, ''), NULLIF(s.last_name, ''))",
    "c.code",
    "CASE WHEN s.student_id IS NULL THEN 'Unknown student' ELSE '' END",
    "t.kiosk_code",
    "'Revealed'",
    ...dateSearchFields("t.created_at"),
  ]);
  const period = await transactionPeriod(req.query);
  let where = transactionWhere;
  const values = [period?.id || 0];
  if (search.sql) {
    where += ` AND ${search.sql}`;
    values.push(...search.values);
  }
  // Keep the array response compatible with older clients during deployment.
  if (req.query.page !== undefined) {
    const requestedPage = Number(req.query.page);
    const requestedLimit = Number(req.query.limit);
    const limit = [10, 25, 50, 100].includes(requestedLimit)
      ? requestedLimit
      : 25;
    const [[summary]] = await pool.execute(
      `SELECT COUNT(*) AS total,
        COALESCE(SUM(DATE(t.created_at)=CURRENT_DATE()), 0) AS today,
        COUNT(DISTINCT t.student_id) AS studentsServed
       FROM credential_transactions t${search.term ? " LEFT JOIN students s ON s.id=t.student_id LEFT JOIN courses c ON c.id=s.course_id" : ""} WHERE ${where}`,
      values,
    );
    const total = Number(summary.total);
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(
      pages,
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1,
    );
    const [rows] = await pool.query(
      `${transactionSelect} WHERE ${where}
       ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      [...values, limit, (page - 1) * limit],
    );
    return res.set("Cache-Control", "no-store").json({
      rows,
      page,
      limit,
      pages,
      total,
      today: Number(summary.today),
      studentsServed: Number(summary.studentsServed),
    });
  }
  const [rows] = await pool.query(
    `${transactionSelect} WHERE ${where}
     ORDER BY t.created_at DESC, t.id DESC LIMIT 1000`,
    values,
  );
  res.set("Cache-Control", "no-store").json(rows);
}
