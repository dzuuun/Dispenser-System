import { pool } from "../config/db.js";
import { decryptPassword } from "../services/encryption.service.js";
import { encryptPassword } from "../services/encryption.service.js";
import { auditAdminAction } from "../services/audit.service.js";

export async function listStudents(req, res) {
  // Supports both the regular API and DataTables server-side paging requests.
  const draw = Number(req.query.draw) || null;
  const limit = Math.min(
    draw ? 100 : 10000,
    Math.max(10, Number(req.query.length || req.query.limit) || 20),
  );
  const page = Math.max(
    1,
    draw
      ? Math.floor((Number(req.query.start) || 0) / limit) + 1
      : Number(req.query.page) || 1,
  );
  const search = String(
    req.query["search[value]"] || req.query.search || "",
  ).trim();
  const status = String(req.query.status || "all");
  const filters = [],
    values = [];
  if (search) {
    const q = `%${search}%`;
    const numericSearch = /^\d+$/.test(search);
    filters.push(
      `(s.student_id LIKE ? OR s.kumosoft_id LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR CONCAT_WS(' ', s.first_name, s.middle_name, s.last_name) LIKE ?${numericSearch ? " OR s.id=?" : ""})`,
    );
    values.push(q, q, q, q, q);
    if (numericSearch) values.push(Number(search));
  }
  if (status === "active") filters.push("s.is_active=1");
  if (status === "inactive") filters.push("s.is_active=0");
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const orderBy =
    {
      name: "s.last_name, s.first_name, s.student_id",
      studentId: "s.student_id",
      course: "c.code, s.last_name, s.first_name",
      status: "s.is_active DESC, s.last_name, s.first_name",
    }[String(req.query.sort || "name")] ||
    "s.last_name, s.first_name, s.student_id";
  const direction =
    String(req.query.direction || "asc").toLowerCase() === "desc"
      ? "DESC"
      : "ASC";
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) total, SUM(s.is_active=1) active_total FROM students s ${where}`,
    values,
  );
  const [rows] = await pool.execute(
    `SELECT s.id, s.student_id, s.kumosoft_id, s.first_name, s.middle_name, s.last_name, s.year_level, s.is_active, c.code course_code, c.name course_name FROM students s JOIN courses c ON c.id=s.course_id ${where} ORDER BY ${orderBy} ${direction} LIMIT ? OFFSET ?`,
    [...values, limit, (page - 1) * limit],
  );
  const response = {
    rows,
    page,
    limit,
    total: Number(count.total),
    pages: Math.max(1, Math.ceil(Number(count.total) / limit)),
    activeTotal: Number(count.active_total || 0),
  };
  res.json(
    draw
      ? {
          draw,
          recordsTotal: Number(count.total),
          recordsFiltered: Number(count.total),
          data: rows,
        }
      : response,
  );
}
export async function getStudent(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "Invalid student record." });
  const [[student]] = await pool.execute(
    "SELECT s.id, s.student_id, s.kumosoft_id, s.first_name, s.middle_name, s.last_name, s.birth_date, s.year_level, s.is_active, c.code course_code, c.name course_name FROM students s JOIN courses c ON c.id=s.course_id WHERE s.id=?",
    [id],
  );
  if (!student)
    return res.status(404).json({ message: "Student record not found." });
  const [[[satp]], [[schoology]], [[kumosoft]], [[email]], [[voucher]]] =
    await Promise.all([
      pool.execute(
        "SELECT username, encrypted_password, password_iv, password_auth_tag, is_active FROM satp_accounts WHERE student_id=?",
        [id],
      ),
      pool.execute(
        "SELECT username, encrypted_password, password_iv, password_auth_tag, is_active FROM schoology_accounts WHERE student_id=?",
        [id],
      ),
      pool.execute(
        "SELECT username, encrypted_password, password_iv, password_auth_tag, is_active FROM kumosoft_accounts WHERE student_id=?",
        [id],
      ),
      pool.execute(
        "SELECT email_address, encrypted_password, password_iv, password_auth_tag, is_active FROM institutional_email_accounts WHERE student_id=?",
        [id],
      ),
      pool.execute(
        "SELECT w.voucher_code, w.is_assigned, w.assigned_at FROM students s JOIN wifi_vouchers w ON w.id=s.voucher_id WHERE s.id=?",
        [id],
      ),
    ]);
  const account = (row, type) =>
    row
      ? {
          type,
          username: type === "EMAIL" ? row.email_address : row.username,
          password: decryptPassword(row),
          isActive: Boolean(row.is_active),
        }
      : null;
  res.set("Cache-Control", "no-store").json({
    student,
    accounts: [
      account(satp, "SATP"),
      account(schoology, "SCHOOLOGY"),
      account(kumosoft, "KUMOSOFT"),
      account(email, "EMAIL"),
    ].filter(Boolean),
    voucher: voucher
      ? {
          code: voucher.voucher_code,
          assignedAt: voucher.assigned_at,
          isAssigned: Boolean(voucher.is_assigned),
        }
      : null,
  });
  auditAdminAction({
    req,
    action: "VIEW_CREDENTIALS",
    module: "STUDENT",
    recordId: id,
    description: "Viewed linked student credentials.",
  }).catch((error) => console.error("Audit logging failed:", error.message));
}
export async function courseOptions(_req, res) {
  const [courses] = await pool.query(
    "SELECT id, code, name FROM courses WHERE is_active=1 ORDER BY code",
  );
  res.json(courses);
}
export async function createStudent(req, res) {
  const studentId = String(req.body.studentId || "").trim();
  const kumosoftId = String(req.body.kumosoftId || "").trim() || null;
  const firstName = String(req.body.firstName || "").trim();
  const middleName = String(req.body.middleName || "").trim() || null;
  const lastName = String(req.body.lastName || "").trim();
  const birthDate = String(req.body.birthDate || "").trim();
  const courseId = Number(req.body.courseId);
  const isActive = req.body.isActive !== false;
  const satpPassword = String(req.body.satpPassword || "");
  const schoologyPassword = String(req.body.schoologyPassword || "");
  const kumosoftPassword = String(req.body.kumosoftPassword || "");
  const emailAddress = String(req.body.emailAddress || "")
    .trim()
    .toLowerCase();
  const emailPassword = String(req.body.emailPassword || "");
  if (
    !studentId ||
    !firstName ||
    !lastName ||
    !birthDate ||
    !Number.isInteger(courseId)
  )
    return res
      .status(400)
      .json({ message: "School ID, name, birthday, and course are required." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate))
    return res.status(400).json({ message: "Enter a valid birthday." });
  if (Boolean(emailAddress) !== Boolean(emailPassword))
    return res.status(400).json({
      message:
        "Provide both the institutional email address and its password, or leave both empty.",
    });
  if (emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress))
    return res
      .status(400)
      .json({ message: "Enter a valid institutional email address." });
  const [[course]] = await pool.execute(
    "SELECT id FROM courses WHERE id=? AND is_active=1",
    [courseId],
  );
  if (!course)
    return res.status(400).json({ message: "Select an active course." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute(
      "INSERT INTO students (student_id, kumosoft_id, first_name, middle_name, last_name, birth_date, course_id, year_level, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      [
        studentId,
        kumosoftId,
        firstName,
        middleName,
        lastName,
        birthDate,
        courseId,
        isActive,
      ],
    );
    const addAccount = async (
      table,
      password,
      email = false,
      username = studentId,
    ) => {
      if (!password) return;
      const encrypted = encryptPassword(password);
      const column = email ? "email_address" : "username";
      const login = email ? emailAddress : username;
      await connection.execute(
        `INSERT INTO ${table} (student_id, ${column}, encrypted_password, password_iv, password_auth_tag, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
        [
          created.insertId,
          login,
          encrypted.encrypted_password,
          encrypted.password_iv,
          encrypted.password_auth_tag,
        ],
      );
    };
    await addAccount("satp_accounts", satpPassword);
    await addAccount("schoology_accounts", schoologyPassword);
    await addAccount(
      "kumosoft_accounts",
      kumosoftPassword,
      false,
      kumosoftId || studentId,
    );
    await addAccount("institutional_email_accounts", emailPassword, true);
    await connection.commit();
    res
      .status(201)
      .json({ id: created.insertId, message: "Student added successfully." });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That School ID or Kumosoft ID already exists." });
    throw error;
  } finally {
    connection.release();
  }
}
export async function updateStudent(req, res) {
  const id = Number(req.params.id),
    studentId = String(req.body.studentId || "").trim(),
    kumosoftId = String(req.body.kumosoftId || "").trim() || null,
    firstName = String(req.body.firstName || "").trim(),
    middleName = String(req.body.middleName || "").trim() || null,
    lastName = String(req.body.lastName || "").trim(),
    birthDate = String(req.body.birthDate || "").trim(),
    courseId = Number(req.body.courseId),
    isActive = req.body.isActive !== false;
  if (
    !Number.isInteger(id) ||
    !studentId ||
    !firstName ||
    !lastName ||
    !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
    !Number.isInteger(courseId)
  )
    return res
      .status(400)
      .json({ message: "School ID, name, birthday, and course are required." });
  const satpPassword = String(req.body.satpPassword || ""),
    schoologyPassword = String(req.body.schoologyPassword || ""),
    kumosoftPassword = String(req.body.kumosoftPassword || ""),
    emailAddress = String(req.body.emailAddress || "")
      .trim()
      .toLowerCase(),
    emailPassword = String(req.body.emailPassword || "");
  const voucherCode = String(req.body.voucherCode || "").trim();
  const assignNextVoucher = req.body.assignNextVoucher === true,
    unassignVoucher = req.body.unassignVoucher === true;
  if (Boolean(emailAddress) !== Boolean(emailPassword))
    return res.status(400).json({
      message:
        "Provide both the institutional email address and its password, or leave both empty.",
    });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[course]] = await connection.execute(
      "SELECT id FROM courses WHERE id=? AND is_active=1",
      [courseId],
    );
    if (!course) {
      await connection.rollback();
      return res.status(400).json({ message: "Select an active course." });
    }
    const [updated] = await connection.execute(
      "UPDATE students SET student_id=?, kumosoft_id=?, first_name=?, middle_name=?, last_name=?, birth_date=?, course_id=?, is_active=? WHERE id=?",
      [
        studentId,
        kumosoftId,
        firstName,
        middleName,
        lastName,
        birthDate,
        courseId,
        isActive,
        id,
      ],
    );
    if (!updated.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: "Student record not found." });
    }
    await Promise.all(
      [
        ["satp_accounts", studentId],
        ["schoology_accounts", studentId],
        ["kumosoft_accounts", kumosoftId || studentId],
      ].map(([table, username]) =>
        connection.execute(
          `UPDATE ${table} SET username=? WHERE student_id=?`,
          [username, id],
        ),
      ),
    );
    const saveAccount = async (
      table,
      password,
      email = false,
      username = studentId,
    ) => {
      if (!password) return;
      const encrypted = encryptPassword(password),
        column = email ? "email_address" : "username",
        login = email ? emailAddress : username;
      await connection.execute(
        `INSERT INTO ${table} (student_id, ${column}, encrypted_password, password_iv, password_auth_tag, is_active) VALUES (?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE ${column}=VALUES(${column}), encrypted_password=VALUES(encrypted_password), password_iv=VALUES(password_iv), password_auth_tag=VALUES(password_auth_tag), is_active=1`,
        [
          id,
          login,
          encrypted.encrypted_password,
          encrypted.password_iv,
          encrypted.password_auth_tag,
        ],
      );
    };
    await saveAccount("satp_accounts", satpPassword);
    await saveAccount("schoology_accounts", schoologyPassword);
    await saveAccount(
      "kumosoft_accounts",
      kumosoftPassword,
      false,
      kumosoftId || studentId,
    );
    await saveAccount("institutional_email_accounts", emailPassword, true);
    if (unassignVoucher) {
      const [[current]] = await connection.execute(
        "SELECT voucher_id FROM students WHERE id=?",
        [id],
      );
      await connection.execute(
        "UPDATE students SET voucher_id=NULL WHERE id=?",
        [id],
      );
      if (current?.voucher_id)
        await connection.execute(
          "UPDATE wifi_vouchers SET is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
          [current.voucher_id],
        );
    } else if (assignNextVoucher) {
      const [[available]] = await connection.query(
        "SELECT id FROM wifi_vouchers WHERE is_active=1 AND is_assigned=0 AND is_released=0 ORDER BY id LIMIT 1 FOR UPDATE",
      );
      if (!available) {
        await connection.rollback();
        return res.status(400).json({
          message: "No available WiFi vouchers remain for the current period.",
        });
      }
      const [[current]] = await connection.execute(
        "SELECT voucher_id FROM students WHERE id=? FOR UPDATE",
        [id],
      );
      if (current?.voucher_id)
        await connection.execute(
          "UPDATE wifi_vouchers SET is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
          [current.voucher_id],
        );
      await connection.execute("UPDATE students SET voucher_id=? WHERE id=?", [
        available.id,
        id,
      ]);
      await connection.execute(
        "UPDATE wifi_vouchers SET is_assigned=1, is_released=0, assigned_at=NOW(), released_at=NULL WHERE id=?",
        [available.id],
      );
    } else if (voucherCode) {
      const [[voucher]] = await connection.execute(
        "SELECT id, is_assigned, is_active FROM wifi_vouchers WHERE voucher_code=? LIMIT 1 FOR UPDATE",
        [voucherCode],
      );
      if (!voucher) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "WiFi voucher code was not found." });
      }
      if (!voucher.is_active) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "This WiFi voucher is inactive." });
      }
      const [[otherStudent]] = await connection.execute(
        "SELECT id FROM students WHERE voucher_id=? AND id<>? LIMIT 1",
        [voucher.id, id],
      );
      if (otherStudent) {
        await connection.rollback();
        return res
          .status(409)
          .json({ message: "This WiFi voucher is already assigned." });
      }
      const [[current]] = await connection.execute(
        "SELECT voucher_id FROM students WHERE id=? FOR UPDATE",
        [id],
      );
      if (current?.voucher_id && current.voucher_id !== voucher.id)
        await connection.execute(
          "UPDATE wifi_vouchers SET is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
          [current.voucher_id],
        );
      await connection.execute("UPDATE students SET voucher_id=? WHERE id=?", [
        voucher.id,
        id,
      ]);
      await connection.execute(
        "UPDATE wifi_vouchers SET is_assigned=1, is_released=0, assigned_at=NOW(), released_at=NULL WHERE id=?",
        [voucher.id],
      );
    }
    await connection.commit();
    res.json({ id, message: "Student updated successfully." });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That School ID already exists." });
    throw error;
  } finally {
    connection.release();
  }
}

export async function generateStudentVoucher(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "Invalid student record." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[student]] = await connection.execute(
      "SELECT id, voucher_id FROM students WHERE id=? FOR UPDATE",
      [id],
    );
    if (!student)
      return res.status(404).json({ message: "Student record not found." });
    const [[voucher]] = await connection.query(
      "SELECT id, voucher_code FROM wifi_vouchers WHERE is_active=1 AND is_assigned=0 AND is_released=0 LIMIT 1 FOR UPDATE",
    );
    if (!voucher)
      return res.status(400).json({
        message: "No available WiFi vouchers remain for the current period.",
      });
    if (student.voucher_id)
      await connection.execute(
        "UPDATE wifi_vouchers SET is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
        [student.voucher_id],
      );
    await connection.execute("UPDATE students SET voucher_id=? WHERE id=?", [
      voucher.id,
      id,
    ]);
    await connection.execute(
      "UPDATE wifi_vouchers SET is_assigned=1, is_released=0, assigned_at=NOW(), released_at=NULL WHERE id=?",
      [voucher.id],
    );
    await connection.commit();
    res.json({
      voucherCode: voucher.voucher_code,
      message: "WiFi voucher assigned.",
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
