import { studentFullName } from "../../shared/student-name.mjs";
import ExcelJS from "exceljs";
import { pool } from "../config/db.js";
import { decryptPassword } from "../services/encryption.service.js";
import { encryptPassword } from "../services/encryption.service.js";
import { auditAdminAction } from "../services/audit.service.js";
import { tableSearch } from "../services/table-search.service.js";
import {
  currentAcademicPeriod,
  requireCurrentAcademicPeriod,
} from "../services/academic-period.service.js";

const studentAccountTypes = [
  {
    type: "EMAIL",
    label: "Email",
    table: "institutional_email_accounts",
    alias: "email_account",
  },
  {
    type: "KUMOSOFT",
    label: "Kumosoft",
    table: "kumosoft_accounts",
    alias: "kumosoft_account",
  },
  {
    type: "SCHOOLOGY",
    label: "Schoology",
    table: "schoology_accounts",
    alias: "schoology_account",
  },
  {
    type: "SATP",
    label: "SATP",
    table: "satp_accounts",
    alias: "satp_account",
  },
];
// Each account table has a unique student_id, so these joins preserve paging/counts.
const studentAccountJoins = studentAccountTypes
  .map(
    ({ table, alias }) =>
      `LEFT JOIN ${table} ${alias} ON ${alias}.student_id=s.id`,
  )
  .join(" ");

function studentListQuery(query) {
  const missingAccount = query.missingAccount ?? "";
  if (
    typeof missingAccount !== "string" ||
    (missingAccount !== "" &&
      missingAccount !== "NONE" &&
      !studentAccountTypes.some(({ type }) => type === missingAccount))
  )
    throw Object.assign(new Error("Choose a valid missing account filter."), {
      status: 400,
    });
  const search = tableSearch(query["search[value]"] ?? query.search, [
    "s.student_id",
    "s.kumosoft_id",
    "CONCAT_WS(' ', NULLIF(s.first_name, ''), NULLIF(NULLIF(TRIM(s.middle_name), '-'), ''), NULLIF(s.last_name, ''))",
    "c.code",
    "c.name",
    "CASE WHEN s.is_active=1 THEN 'Active' ELSE 'Inactive' END",
    ...studentAccountTypes.map(
      ({ label, alias }) =>
        `CASE WHEN ${alias}.student_id IS NOT NULL THEN CONCAT('${label}', IF(${alias}.is_active=0, ' (inactive)', '')) ELSE '' END`,
    ),
    `CASE WHEN ${studentAccountTypes.map(({ alias }) => `${alias}.student_id IS NULL`).join(" AND ")} THEN 'No linked accounts' ELSE '' END`,
  ]);
  const status = String(query.status || "all");
  const filters = ["s.academic_period_id=?"],
    values = [];
  if (search.sql) {
    const numericId =
      /^\d+$/.test(search.term) && Number.isSafeInteger(Number(search.term));
    filters.push(numericId ? `(${search.sql} OR s.id=?)` : search.sql);
    values.push(...search.values);
    if (numericId) values.push(Number(search.term));
  }
  if (status === "active") filters.push("s.is_active=1");
  if (status === "inactive") filters.push("s.is_active=0");
  for (const { type, table } of studentAccountTypes) {
    if (missingAccount === type || missingAccount === "NONE")
      filters.push(
        `NOT EXISTS (SELECT 1 FROM ${table} missing_account WHERE missing_account.student_id=s.id)`,
      );
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const orderBy =
    {
      name: "s.last_name, s.first_name, s.student_id",
      studentId: "s.student_id",
      course: "c.code, s.last_name, s.first_name",
      status: "s.is_active DESC, s.last_name, s.first_name",
    }[String(query.sort || "name")] ||
    "s.last_name, s.first_name, s.student_id";
  const direction =
    String(query.direction || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
  return { search, where, values, orderBy, direction };
}

const studentListSelect = `SELECT s.id, s.student_id, s.kumosoft_id, s.first_name, s.middle_name, s.last_name, s.year_level, s.is_active, c.code course_code, c.name course_name,
      email_account.email_address AS email_address,
      ${studentAccountTypes.map(({ alias }) => `${alias}.is_active AS ${alias}_active`).join(", ")}
     FROM students s JOIN courses c ON c.id=s.course_id ${studentAccountJoins}`;

export async function listStudents(req, res) {
  const {
    search,
    where,
    values: filterValues,
    orderBy,
    direction,
  } = studentListQuery(req.query);
  const currentPeriod = await currentAcademicPeriod();
  const values = [currentPeriod?.id || 0, ...filterValues];
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
  const [[count]] = await pool.execute(
    `SELECT COUNT(*) total, SUM(s.is_active=1) active_total FROM students s${search.term ? ` JOIN courses c ON c.id=s.course_id ${studentAccountJoins}` : ""} ${where}`,
    values,
  );
  const [records] = await pool.execute(
    `${studentListSelect} ${where} ORDER BY ${orderBy} ${direction} LIMIT ? OFFSET ?`,
    [...values, limit, (page - 1) * limit],
  );
  const rows = records.map((record) => {
    const student = { ...record, linkedAccounts: [] };
    for (const { type, alias } of studentAccountTypes) {
      const field = `${alias}_active`;
      if (record[field] != null)
        student.linkedAccounts.push({ type, isActive: Boolean(record[field]) });
      delete student[field];
    }
    return student;
  });
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

export async function exportStudentAccounts(req, res) {
  const { where, values, orderBy, direction } = studentListQuery(req.query);
  const period = await requireCurrentAcademicPeriod();
  // Use the table's filters and ordering, but export every matching student.
  const [students] = await pool.execute(
    `${studentListSelect} ${where} ORDER BY ${orderBy} ${direction}`,
    [period.id, ...values],
  );
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Student linked accounts");
  sheet.columns = [
    { header: "School ID", key: "schoolId", width: 18 },
    { header: "Kumosoft ID", key: "kumosoftId", width: 18 },
    { header: "Student name", key: "name", width: 44 },
    { header: "Course code", key: "courseCode", width: 18 },
    { header: "Course name", key: "courseName", width: 55 },
    { header: "Student status", key: "status", width: 18 },
    ...studentAccountTypes.map(({ type, label }) => ({
      header: label,
      key: type,
      width: type === "EMAIL" ? 38 : 16,
    })),
  ];
  for (const student of students)
    sheet.addRow({
      schoolId: String(student.student_id ?? ""),
      kumosoftId: String(student.kumosoft_id ?? ""),
      name: studentFullName(student),
      courseCode: student.course_code || "",
      courseName: student.course_name || "",
      status: student.is_active ? "Active" : "Inactive",
      ...Object.fromEntries(
        studentAccountTypes.map(({ type, alias }) => [
          type,
          type === "EMAIL"
            ? student.email_address || "No"
            : student[`${alias}_active`] != null ? "Yes" : "No",
        ]),
      ),
    });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "J1" };
  const label = `${period.school_year}-${period.semester}`.replace(
    /[^a-zA-Z0-9-]+/g,
    "-",
  );
  res
    .set({
      "Cache-Control": "no-store",
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="students-linked-accounts-${label}-${period.id}.xlsx"`,
    })
    .send(Buffer.from(await workbook.xlsx.writeBuffer()));
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
    const period = await requireCurrentAcademicPeriod(connection);
    const [created] = await connection.execute(
      "INSERT INTO students (student_id, kumosoft_id, first_name, middle_name, last_name, birth_date, course_id, academic_period_id, year_level, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      [
        studentId,
        kumosoftId,
        firstName,
        middleName,
        lastName,
        birthDate,
        courseId,
        period.id,
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
  const emailAddress = String(req.body.emailAddress || "")
      .trim()
      .toLowerCase(),
    emailPassword = String(req.body.emailPassword || "");
  const voucherCode = String(req.body.voucherCode || "").trim();
  const assignNextVoucher = req.body.assignNextVoucher === true,
    unassignVoucher = req.body.unassignVoucher === true;
  if (emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress))
    return res
      .status(400)
      .json({ message: "Enter a valid institutional email address." });
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
      passwordField,
      email = false,
      username = studentId,
    ) => {
      if (!Object.hasOwn(req.body, passwordField)) return;
      const password = String(req.body[passwordField] ?? "");
      if (!password.trim()) {
        // Empty strings also support older schemas with NOT NULL columns.
        // All readers already treat an empty encrypted password as unavailable.
        await connection.execute(
          `UPDATE ${table} SET encrypted_password='', password_iv='', password_auth_tag='' WHERE student_id=?`,
          [id],
        );
        return;
      }
      const encrypted = encryptPassword(password),
        column = email ? "email_address" : "username",
        login = username;
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
    await saveAccount("satp_accounts", "satpPassword");
    await saveAccount("schoology_accounts", "schoologyPassword");
    await saveAccount(
      "kumosoft_accounts",
      "kumosoftPassword",
      false,
      kumosoftId || studentId,
    );
    const hasEmailAddress = Object.hasOwn(req.body, "emailAddress");
    const hasEmailPassword = Object.hasOwn(req.body, "emailPassword");
    if (hasEmailAddress && !emailAddress) {
      await connection.execute(
        "DELETE FROM institutional_email_accounts WHERE student_id=?",
        [id],
      );
    } else if (hasEmailAddress || hasEmailPassword) {
      const [[existingEmail]] = await connection.execute(
        "SELECT email_address FROM institutional_email_accounts WHERE student_id=? FOR UPDATE",
        [id],
      );
      const login = hasEmailAddress
        ? emailAddress
        : existingEmail?.email_address;
      if (login || emailPassword.trim()) {
        if (!existingEmail && (!login || !emailPassword.trim())) {
          await connection.rollback();
          return res.status(400).json({
            message:
              "Provide an institutional email address and password when adding a new email account.",
          });
        }
        if (existingEmail && hasEmailAddress) {
          await connection.execute(
            "UPDATE institutional_email_accounts SET email_address=? WHERE student_id=?",
            [login, id],
          );
        }
        await saveAccount(
          "institutional_email_accounts",
          "emailPassword",
          true,
          login,
        );
      }
    }
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
          "UPDATE wifi_vouchers SET is_active=0, is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
          [current.voucher_id],
        );
    } else if (assignNextVoucher) {
      const [[available]] = await connection.query(
        "SELECT id FROM wifi_vouchers WHERE academic_period_id=(SELECT academic_period_id FROM students WHERE id=?) AND is_active=1 AND is_assigned=0 AND is_released=0 ORDER BY id LIMIT 1 FOR UPDATE",
        [id],
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
          "UPDATE wifi_vouchers SET is_active=0, is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
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
        "SELECT id, is_assigned, is_active FROM wifi_vouchers WHERE voucher_code=? AND academic_period_id=(SELECT academic_period_id FROM students WHERE id=?) LIMIT 1 FOR UPDATE",
        [voucherCode, id],
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
          "UPDATE wifi_vouchers SET is_active=0, is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
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
      return res.status(409).json({
        message:
          "That School ID, Kumosoft ID, or institutional email is already in use.",
      });
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
    if (!student) {
      await connection.rollback();
      return res.status(404).json({ message: "Student record not found." });
    }
    const [[voucher]] = await connection.query(
      "SELECT id, voucher_code FROM wifi_vouchers WHERE academic_period_id=(SELECT academic_period_id FROM students WHERE id=?) AND is_active=1 AND is_assigned=0 AND is_released=0 LIMIT 1 FOR UPDATE",
      [id],
    );
    if (!voucher) {
      await connection.rollback();
      return res.status(400).json({
        message: "No available WiFi vouchers remain for the current period.",
      });
    }
    if (student.voucher_id)
      await connection.execute(
        "UPDATE wifi_vouchers SET is_active=0, is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
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
