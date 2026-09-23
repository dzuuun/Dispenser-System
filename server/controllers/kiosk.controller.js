import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import { decryptPassword } from "../services/encryption.service.js";
import { transaction } from "../services/audit.service.js";
const verification = z.object({
  studentId: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(100),
  birthDate: z.string().date(),
  courseId: z.coerce.number().int().positive(),
});
const accountTables = {
  SATP: "satp_accounts",
  SCHOOLOGY: "schoology_accounts",
  KUMOSOFT: "kumosoft_accounts",
  EMAIL: "institutional_email_accounts",
};

function normalizeNameForVerification(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en");
}

async function moduleControls(executor = pool) {
  const [rows] = await executor.query(
    "SELECT module_key, is_visible, is_maintenance FROM credential_module_controls",
  );
  return new Map(
    rows.map((row) => [
      row.module_key,
      {
        visible: Boolean(row.is_visible),
        maintenance: Boolean(row.is_maintenance),
      },
    ]),
  );
}

async function activeKioskSession(req) {
  try {
    const session = jwt.verify(
      req.headers.authorization?.replace(/^Bearer\s+/i, ""),
      config().accessSecret,
    );
    if (session.scope !== "kiosk-credentials") return null;
    const [[stored]] = await pool.execute(
      "SELECT student_id FROM kiosk_credential_sessions WHERE id=? AND expires_at>NOW()",
      [session.jti],
    );
    return stored && Number(stored.student_id) === Number(session.sub)
      ? session
      : null;
  } catch {
    return null;
  }
}
export async function courses(_req, res) {
  const [rows] = await pool.query(
    "SELECT id, code, name FROM courses WHERE is_active=1 ORDER BY code",
  );
  res.json(rows);
}
export async function reminders(_req, res) {
  const [rows] = await pool.query(
    `SELECT id, placement, title, message
       FROM kiosk_reminders
      WHERE is_active=1
      ORDER BY sort_order, id`,
  );
  res.set("Cache-Control", "no-store").json(rows);
}
export async function verify(req, res) {
  const controls = await moduleControls();
  const kioskControl = controls.get("KIOSK");
  if (kioskControl?.maintenance)
    return res.status(503).json({
      message: "The credentials dispenser is currently under maintenance.",
    });
  const parsed = verification.safeParse(req.body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const messages = {
      studentId: "Enter your Student ID or Kumosoft ID.",
      lastName: "Enter your last name.",
      birthDate: "Enter a valid birthday.",
      courseId: "Search for and select your course.",
    };
    return res
      .status(400)
      .json({ message: messages[field] || "Please complete all fields." });
  }
  const v = parsed.data;
  const [rows] = await pool.execute(
    `SELECT id, student_id, first_name, middle_name, last_name, year_level,
            course_id, is_active, DATE_FORMAT(birth_date, '%Y-%m-%d') birth_date
       FROM students
      WHERE student_id=? OR kumosoft_id=?
      LIMIT 1`,
    [v.studentId, v.studentId],
  );
  const student = rows[0];
  let failureMessage = "";
  if (!student) failureMessage = "Student ID or Kumosoft ID was not found.";
  else if (!student.is_active)
    failureMessage =
      "This student record is inactive. Please proceed to the ICT/MIS Office.";
  else if (
    normalizeNameForVerification(student.last_name) !==
    normalizeNameForVerification(v.lastName)
  )
    failureMessage = "The last name does not match the student record.";
  else if (String(student.birth_date) !== v.birthDate)
    failureMessage = "The birthday does not match the student record.";
  else if (Number(student.course_id) !== Number(v.courseId))
    failureMessage = "The selected course does not match the student record.";
  if (failureMessage)
    return res
      .status(student && !student.is_active ? 403 : 401)
      .json({ message: failureMessage });
  const jti = crypto.randomUUID();
  await pool.execute(
    "INSERT INTO kiosk_credential_sessions (id, student_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 3 MINUTE))",
    [jti, student.id],
  );
  res.set("Cache-Control", "no-store").json({
    token: jwt.sign(
      { sub: student.id, scope: "kiosk-credentials", jti },
      config().accessSecret,
      { expiresIn: "3m" },
    ),
    student: {
      studentId: student.student_id,
      fullName: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),
      yearLevel: student.year_level,
    },
  });
}
export async function credentials(req, res) {
  const session = await activeKioskSession(req);
  if (!session) {
    return res
      .status(401)
      .json({ message: "Session expired. Please verify again." });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[student]] = await conn.execute(
      "SELECT s.student_id, s.first_name, s.middle_name, s.last_name, s.year_level, c.code course_code, c.name course_name FROM students s JOIN courses c ON c.id=s.course_id WHERE s.id=?",
      [session.sub],
    );
    const [creds] = await conn.execute(
      "SELECT 'SATP' credential_type, username FROM satp_accounts WHERE student_id=? AND is_active=1 UNION ALL SELECT 'SCHOOLOGY' credential_type, username FROM schoology_accounts WHERE student_id=? AND is_active=1 UNION ALL SELECT 'KUMOSOFT' credential_type, username FROM kumosoft_accounts WHERE student_id=? AND is_active=1 UNION ALL SELECT 'EMAIL' credential_type, email_address username FROM institutional_email_accounts WHERE student_id=? AND is_active=1",
      [session.sub, session.sub, session.sub, session.sub],
    );
    const [requestRecords] = await conn.execute(
      `SELECT credential_type, request_kind, status,
              DATE_FORMAT(requested_at, '%Y-%m-%d %H:%i:%s') requested_at,
              DATE_FORMAT(resolved_at, '%Y-%m-%d %H:%i:%s') resolved_at
         FROM password_reset_requests
        WHERE student_id=?
        ORDER BY requested_at DESC, id DESC`,
      [session.sub],
    );
    const latestRequests = new Map();
    for (const request of requestRecords) {
      const key = `${request.credential_type}:${request.request_kind}`;
      if (!latestRequests.has(key)) latestRequests.set(key, request);
    }
    const controls = await moduleControls(conn);
    const kioskControl = controls.get("KIOSK");
    if (kioskControl?.maintenance) {
      await conn.rollback();
      return res.status(503).json({
        message: "The credentials dispenser is currently under maintenance.",
      });
    }
    const voucherControl = controls.get("VOUCHER") || {
      visible: true,
      maintenance: false,
    };
    const [[existing]] = await conn.execute(
      "SELECT w.voucher_code FROM students s JOIN wifi_vouchers w ON w.id=s.voucher_id WHERE s.id=?",
      [session.sub],
    );
    let voucher = existing?.voucher_code;
    if (voucherControl.visible && !voucherControl.maintenance && !voucher) {
      const [[available]] = await conn.query(
        "SELECT id, voucher_code FROM wifi_vouchers WHERE is_active=1 AND is_assigned=0 AND is_released=0 LIMIT 1 FOR UPDATE",
      );
      if (available) {
        await conn.execute("UPDATE students SET voucher_id=? WHERE id=?", [
          available.id,
          session.sub,
        ]);
        await conn.execute(
          "UPDATE wifi_vouchers SET is_assigned=1, assigned_at=NOW() WHERE id=?",
          [available.id],
        );
        voucher = available.voucher_code;
      }
    }
    await conn.commit();
    res
      .set("Cache-Control", "no-store, no-cache, must-revalidate, private")
      .json({
        student: {
          studentId: student.student_id,
          fullName: [student.first_name, student.middle_name, student.last_name]
            .filter(Boolean)
            .join(" "),
          yearLevel: student.year_level,
          course: `${student.course_code} — ${student.course_name}`,
        },
        credentials: ["SATP", "SCHOOLOGY", "KUMOSOFT", "EMAIL"]
          .filter((type) => controls.get(type)?.visible ?? true)
          .map((type) => {
            const credential = creds.find(
              (item) => item.credential_type === type,
            );
            return {
              type,
              username: credential?.username || null,
              unavailable: !credential,
              maintenance: controls.get(type)?.maintenance || false,
            };
          }),
        voucherState: !voucherControl.visible
          ? "HIDDEN"
          : voucherControl.maintenance
            ? "MAINTENANCE"
            : voucher
              ? "AVAILABLE"
              : "PENDING",
        hasWifiVoucher: voucherControl.visible && Boolean(voucher),
        pendingRequests: [...latestRequests.values()]
          .filter((request) => request.status === "PENDING")
          .map((request) => ({
            type: request.credential_type,
            kind: request.request_kind,
            requestedAt: request.requested_at,
          })),
        requestOutcomes: [...latestRequests.values()]
          .filter((request) => request.status !== "PENDING")
          .map((request) => ({
            type: request.credential_type,
            kind: request.request_kind,
            status: request.status,
            resolvedAt: request.resolved_at,
          })),
      });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
export async function revealCredentials(req, res) {
  const session = await activeKioskSession(req);
  if (!session)
    return res
      .status(401)
      .json({ message: "Session expired. Please verify again." });
  try {
    const controls = await moduleControls();
    const kioskControl = controls.get("KIOSK");
    if (kioskControl?.maintenance)
      return res.status(503).json({
        message: "The credentials dispenser is currently under maintenance.",
      });
    const [[student]] = await pool.execute(
      "SELECT student_id FROM students WHERE id=? AND is_active=1",
      [session.sub],
    );
    if (!student)
      return res
        .status(404)
        .json({ message: "Student record is not available." });
    const [rows] = await pool.execute(
      "SELECT 'SATP' credential_type, username, encrypted_password, password_iv, password_auth_tag FROM satp_accounts WHERE student_id=? AND is_active=1 UNION ALL SELECT 'SCHOOLOGY' credential_type, username, encrypted_password, password_iv, password_auth_tag FROM schoology_accounts WHERE student_id=? AND is_active=1 UNION ALL SELECT 'KUMOSOFT' credential_type, username, encrypted_password, password_iv, password_auth_tag FROM kumosoft_accounts WHERE student_id=? AND is_active=1 UNION ALL SELECT 'EMAIL' credential_type, email_address username, encrypted_password, password_iv, password_auth_tag FROM institutional_email_accounts WHERE student_id=? AND is_active=1",
      [session.sub, session.sub, session.sub, session.sub],
    );
    const [[voucher]] = await pool.execute(
      "SELECT w.voucher_code FROM students s LEFT JOIN wifi_vouchers w ON w.id=s.voucher_id WHERE s.id=?",
      [session.sub],
    );
    const revealedCredentials = rows
      .filter((row) => {
        const control = controls.get(row.credential_type);
        return (control?.visible ?? true) && !control?.maintenance;
      })
      .map((row) => ({
        type: row.credential_type,
        username: row.username,
        password: decryptPassword(row),
      }));
    // A student explicitly confirmed Show All. Record that security-sensitive
    // action even when every credential is currently unavailable or hidden.
    await transaction({
      studentId: session.sub,
      kioskCode: req.kioskCode,
      type: "VIEW_CREDENTIALS",
      success: true,
      ip: req.ip,
      userAgent: req.header("user-agent"),
    });
    res
      .set("Cache-Control", "no-store, no-cache, must-revalidate, private")
      .json({
        credentials: revealedCredentials,
        wifiVoucher:
          controls.get("VOUCHER")?.visible !== false &&
          !controls.get("VOUCHER")?.maintenance
            ? voucher?.voucher_code || null
            : null,
      });
  } catch (error) {
    res.status(500).json({ message: "Unable to reveal credentials." });
  }
}
export async function requestPasswordReset(req, res) {
  const session = await activeKioskSession(req);
  if (!session)
    return res
      .status(401)
      .json({ message: "Session expired. Please verify again." });

  const credentialType = String(req.body?.credentialType || "").toUpperCase();
  if (credentialType === "SATP")
    return res
      .status(400)
      .json({ message: "SATP password reset requests are not required." });
  const table = accountTables[credentialType];
  if (!table)
    return res.status(400).json({ message: "Select a valid account." });
  const controls = await moduleControls();
  const control = controls.get(credentialType);
  if (control && (!control.visible || control.maintenance))
    return res
      .status(503)
      .json({ message: `${credentialType} is not currently available.` });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[account]] = await connection.execute(
      `SELECT id FROM ${table} WHERE student_id=? AND is_active=1 FOR UPDATE`,
      [session.sub],
    );
    if (!account) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "This account is not available." });
    }
    const [[pending]] = await connection.execute(
      `SELECT id FROM password_reset_requests
        WHERE student_id=? AND credential_type=? AND request_kind='PASSWORD_RESET' AND status='PENDING'
        LIMIT 1 FOR UPDATE`,
      [session.sub, credentialType],
    );
    if (pending) {
      await connection.rollback();
      return res.json({
        requestId: pending.id,
        message: `Your ${credentialType} password reset request is already pending.`,
      });
    }
    const [result] = await connection.execute(
      `INSERT INTO password_reset_requests
         (student_id, credential_type, kiosk_code)
       VALUES (?, ?, ?)`,
      [session.sub, credentialType, req.kioskCode],
    );
    await connection.commit();
    res.status(201).json({
      requestId: result.insertId,
      message: `Your ${credentialType} password reset request was submitted.`,
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res.json({
        message: `Your ${credentialType} password reset request is already pending.`,
      });
    res
      .status(500)
      .json({ message: "Unable to submit the password reset request." });
  } finally {
    connection.release();
  }
}
export async function requestNewVoucher(req, res) {
  const session = await activeKioskSession(req);
  if (!session)
    return res
      .status(401)
      .json({ message: "Session expired. Please verify again." });
  const controls = await moduleControls();
  const control = controls.get("VOUCHER");
  if (control && (!control.visible || control.maintenance))
    return res
      .status(503)
      .json({ message: "WiFi vouchers are not currently available." });
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 10 || reason.length > 500)
    return res.status(400).json({
      message: "Explain why you need a new voucher using 10 to 500 characters.",
    });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[student]] = await connection.execute(
      "SELECT voucher_id FROM students WHERE id=? AND is_active=1 FOR UPDATE",
      [session.sub],
    );
    if (!student) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "Student record is not available." });
    }
    if (!student.voucher_id) {
      await connection.rollback();
      return res
        .status(409)
        .json({ message: "There is no current voucher to replace." });
    }
    const [[pending]] = await connection.execute(
      `SELECT id FROM password_reset_requests
        WHERE student_id=? AND credential_type='VOUCHER' AND request_kind='VOUCHER_REQUEST' AND status='PENDING'
        LIMIT 1 FOR UPDATE`,
      [session.sub],
    );
    if (pending) {
      await connection.rollback();
      return res.json({
        requestId: pending.id,
        message: "Your new voucher request is already pending.",
      });
    }
    const [result] = await connection.execute(
      `INSERT INTO password_reset_requests
         (student_id, credential_type, request_kind, request_reason, kiosk_code)
       VALUES (?, 'VOUCHER', 'VOUCHER_REQUEST', ?, ?)`,
      [session.sub, reason, req.kioskCode],
    );
    await connection.commit();
    res.status(201).json({
      requestId: result.insertId,
      message:
        "Your new voucher request was submitted for administrator approval.",
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res.json({
        message: "Your new voucher request is already pending.",
      });
    res
      .status(500)
      .json({ message: "Unable to submit the new voucher request." });
  } finally {
    connection.release();
  }
}
export async function requestAccount(req, res) {
  const session = await activeKioskSession(req);
  if (!session)
    return res
      .status(401)
      .json({ message: "Session expired. Please verify again." });
  const credentialType = String(req.body?.credentialType || "").toUpperCase();
  const table = accountTables[credentialType];
  if (!table)
    return res.status(400).json({ message: "Select a valid account." });
  const controls = await moduleControls();
  const control = controls.get(credentialType);
  if (control && (!control.visible || control.maintenance))
    return res
      .status(503)
      .json({ message: `${credentialType} is not currently available.` });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[account]] = await connection.execute(
      `SELECT id, is_active FROM ${table} WHERE student_id=? FOR UPDATE`,
      [session.sub],
    );
    if (account) {
      await connection.rollback();
      return res.status(409).json({
        message: account.is_active
          ? `A ${credentialType} account is already assigned. Request a password reset instead.`
          : `A ${credentialType} account exists but is inactive. Please proceed to the ICT/MIS Office.`,
      });
    }
    const [[pending]] = await connection.execute(
      `SELECT id FROM password_reset_requests
        WHERE student_id=? AND credential_type=? AND request_kind='ACCOUNT_CREATION' AND status='PENDING'
        LIMIT 1 FOR UPDATE`,
      [session.sub, credentialType],
    );
    if (pending) {
      await connection.rollback();
      return res.json({
        requestId: pending.id,
        message: `Your ${credentialType} account request is already pending.`,
      });
    }
    const [result] = await connection.execute(
      `INSERT INTO password_reset_requests
         (student_id, credential_type, request_kind, kiosk_code)
       VALUES (?, ?, 'ACCOUNT_CREATION', ?)`,
      [session.sub, credentialType, req.kioskCode],
    );
    await connection.commit();
    res.status(201).json({
      requestId: result.insertId,
      message: `Your ${credentialType} account request was submitted.`,
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res.json({
        message: `Your ${credentialType} account request is already pending.`,
      });
    res.status(500).json({ message: "Unable to submit the account request." });
  } finally {
    connection.release();
  }
}
export async function endSession(req, res) {
  try {
    const p = jwt.verify(
      req.headers.authorization?.replace(/^Bearer\s+/i, ""),
      config().accessSecret,
    );
    await pool.execute("DELETE FROM kiosk_credential_sessions WHERE id=?", [
      p.jti,
    ]);
  } catch {}
  res.status(204).end();
}
