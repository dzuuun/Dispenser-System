import { pool } from "../config/db.js";
import {
  decryptPassword,
  encryptPassword,
} from "../services/encryption.service.js";

const accountTables = {
  SATP: "satp_accounts",
  SCHOOLOGY: "schoology_accounts",
  KUMOSOFT: "kumosoft_accounts",
  EMAIL: "institutional_email_accounts",
};

export async function pendingCredentialRequestCount(_req, res) {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) count FROM password_reset_requests WHERE status='PENDING'",
  );
  res.set("Cache-Control", "no-store").json({ count: Number(row.count) });
}

export async function listPasswordResetRequests(_req, res) {
  const [rows] = await pool.query(
    `SELECT pr.id, pr.credential_type, pr.request_kind, pr.request_reason, pr.status, pr.kiosk_code,
            pr.requested_at, pr.resolved_at,
            s.student_id school_id, s.first_name, s.middle_name, s.last_name,
            c.code course_code, au.full_name resolved_by_name,
            CASE pr.credential_type
              WHEN 'SATP' THEN satp.username
              WHEN 'SCHOOLOGY' THEN schoology.username
              WHEN 'KUMOSOFT' THEN kumosoft.username
              WHEN 'EMAIL' THEN email.email_address
              WHEN 'VOUCHER' THEN voucher.voucher_code
            END account_username,
            CASE pr.credential_type
              WHEN 'SATP' THEN satp.encrypted_password
              WHEN 'SCHOOLOGY' THEN schoology.encrypted_password
              WHEN 'KUMOSOFT' THEN kumosoft.encrypted_password
              WHEN 'EMAIL' THEN email.encrypted_password
            END encrypted_password,
            CASE pr.credential_type
              WHEN 'SATP' THEN satp.password_iv
              WHEN 'SCHOOLOGY' THEN schoology.password_iv
              WHEN 'KUMOSOFT' THEN kumosoft.password_iv
              WHEN 'EMAIL' THEN email.password_iv
            END password_iv,
            CASE pr.credential_type
              WHEN 'SATP' THEN satp.password_auth_tag
              WHEN 'SCHOOLOGY' THEN schoology.password_auth_tag
              WHEN 'KUMOSOFT' THEN kumosoft.password_auth_tag
              WHEN 'EMAIL' THEN email.password_auth_tag
            END password_auth_tag
       FROM password_reset_requests pr
       JOIN students s ON s.id=pr.student_id
       JOIN courses c ON c.id=s.course_id
       LEFT JOIN admin_users au ON au.id=pr.resolved_by
       LEFT JOIN satp_accounts satp ON satp.student_id=s.id
       LEFT JOIN schoology_accounts schoology ON schoology.student_id=s.id
       LEFT JOIN kumosoft_accounts kumosoft ON kumosoft.student_id=s.id
       LEFT JOIN institutional_email_accounts email ON email.student_id=s.id
       LEFT JOIN wifi_vouchers voucher ON voucher.id=s.voucher_id
      ORDER BY (pr.status='PENDING') DESC, pr.requested_at DESC
      LIMIT 500`,
  );

  res.set("Cache-Control", "no-store").json(
    rows.map(
      ({ encrypted_password, password_iv, password_auth_tag, ...row }) => ({
        ...row,
        default_password: encrypted_password
          ? decryptPassword({
              encrypted_password,
              password_iv,
              password_auth_tag,
            })
          : null,
      }),
    ),
  );
}

export async function completePasswordResetRequest(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "Invalid reset request." });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[request]] = await connection.execute(
      "SELECT student_id, credential_type, request_kind FROM password_reset_requests WHERE id=? AND status='PENDING' FOR UPDATE",
      [id],
    );
    if (!request) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "Pending credential request not found." });
    }
    if (request.request_kind === "ACCOUNT_CREATION") {
      const password = String(req.body?.password || "");
      const emailAddress = String(req.body?.emailAddress || "")
        .trim()
        .toLowerCase();
      if (!password) {
        await connection.rollback();
        return res.status(400).json({
          message:
            "Enter the new account password before completing this request.",
        });
      }
      if (
        request.credential_type === "EMAIL" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)
      ) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Enter a valid institutional email address." });
      }
      const [[account]] = await connection.execute(
        `SELECT id FROM ${accountTables[request.credential_type]} WHERE student_id=? FOR UPDATE`,
        [request.student_id],
      );
      if (!account) {
        const [[student]] = await connection.execute(
          "SELECT student_id FROM students WHERE id=? AND is_active=1",
          [request.student_id],
        );
        if (!student) {
          await connection.rollback();
          return res
            .status(404)
            .json({ message: "The active student record was not found." });
        }
        const encrypted = encryptPassword(password);
        const loginColumn =
          request.credential_type === "EMAIL" ? "email_address" : "username";
        const login =
          request.credential_type === "EMAIL"
            ? emailAddress
            : student.student_id;
        await connection.execute(
          `INSERT INTO ${accountTables[request.credential_type]}
             (student_id, ${loginColumn}, encrypted_password, password_iv, password_auth_tag, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [
            request.student_id,
            login,
            encrypted.encrypted_password,
            encrypted.password_iv,
            encrypted.password_auth_tag,
          ],
        );
      }
    }
    let assignedVoucher = null;
    if (request.request_kind === "VOUCHER_REQUEST") {
      const [[student]] = await connection.execute(
        "SELECT voucher_id FROM students WHERE id=? FOR UPDATE",
        [request.student_id],
      );
      const [[available]] = await connection.query(
        "SELECT id, voucher_code FROM wifi_vouchers WHERE academic_period_id=(SELECT academic_period_id FROM students WHERE id=?) AND is_active=1 AND is_assigned=0 AND is_released=0 ORDER BY id LIMIT 1 FOR UPDATE",
        [request.student_id],
      );
      if (!available) {
        await connection.rollback();
        return res.status(409).json({
          message:
            "No active voucher is available. Add voucher stock before approving this request.",
        });
      }
      if (student?.voucher_id)
        await connection.execute(
          "UPDATE wifi_vouchers SET is_assigned=0, is_released=1, assigned_at=NULL, released_at=NOW() WHERE id=?",
          [student.voucher_id],
        );
      await connection.execute("UPDATE students SET voucher_id=? WHERE id=?", [
        available.id,
        request.student_id,
      ]);
      await connection.execute(
        "UPDATE wifi_vouchers SET is_assigned=1, is_released=0, assigned_at=NOW(), released_at=NULL WHERE id=?",
        [available.id],
      );
      assignedVoucher = available.voucher_code;
    }
    const [result] = await connection.execute(
      `UPDATE password_reset_requests
          SET status='COMPLETED', resolved_at=NOW(), resolved_by=?
        WHERE id=? AND status='PENDING'`,
      [req.admin.sub, id],
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res
        .status(404)
        .json({ message: "Pending credential request not found." });
    }
    await connection.commit();
    const message =
      request.request_kind === "ACCOUNT_CREATION"
        ? "Account created and request completed."
        : request.request_kind === "VOUCHER_REQUEST"
          ? `Voucher request approved. ${assignedVoucher} was assigned to the student.`
          : "Password reset request marked completed.";
    res.json({ message });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res.status(409).json({
        message:
          "That username or email address is already assigned to another account.",
      });
    throw error;
  } finally {
    connection.release();
  }
}

export async function rejectVoucherRequest(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "Invalid voucher request." });
  const [result] = await pool.execute(
    `UPDATE password_reset_requests
        SET status='REJECTED', resolved_at=NOW(), resolved_by=?
      WHERE id=? AND status='PENDING' AND request_kind='VOUCHER_REQUEST'`,
    [req.admin.sub, id],
  );
  if (!result.affectedRows)
    return res
      .status(404)
      .json({ message: "Pending voucher request not found." });
  res.json({
    message:
      "Voucher request rejected. The student's current voucher was not changed.",
  });
}
