import {
  multiSheetWorkbookBuffer,
  readWorkbookRows,
  workbookBase64,
  workbookBuffer,
} from "../services/workbook.service.js";
import { pool } from "../config/db.js";
import {
  decryptPassword,
  encryptPassword,
} from "../services/encryption.service.js";

const TYPES = {
  courses: {
    label: "Courses",
    sample: {
      CourseCode: "BSIT",
      CourseName: "Bachelor of Science in Information Technology",
    },
  },
  students: {
    label: "Students",
    sample: {
      SchoolID: "2026-00001",
      KumosoftID: "2026-00001",
      LastName: "Dela Cruz",
      FirstName: "Juan",
      MiddleName: "Santos",
      BirthDate: "2005-01-31",
      CourseCode: "BSIT",
    },
  },
  "student-deactivate": {
    label: "Deactivate students",
    sample: { SchoolID: "2026-00001" },
  },
  satp: {
    label: "SATP accounts",
    table: "satp_accounts",
    column: "username",
    sample: { SchoolID: "2026-00001", Password: "temporary-password" },
  },
  schoology: {
    label: "Schoology accounts",
    table: "schoology_accounts",
    column: "username",
    sample: { SchoolID: "2026-00001", Password: "temporary-password" },
  },
  kumosoft: {
    label: "Kumosoft accounts",
    table: "kumosoft_accounts",
    column: "username",
    requiresKumosoftId: true,
    allowEmptyPassword: true,
    sample: {
      SchoolID: "2026-00001",
      KumosoftID: "2026-00001",
      Password: "temporary-password",
    },
  },
  email: {
    label: "Institutional email accounts",
    table: "institutional_email_accounts",
    column: "email_address",
    sample: {
      SchoolID: "2026-00001",
      EmailAddress: "student@ndmu.edu.ph",
      Password: "temporary-password",
    },
  },
  vouchers: {
    label: "WiFi vouchers",
    sample: { VoucherCode: "WIFI-EXAMPLE-001" },
  },
};

const ACCOUNT_IMPORT_BATCH_SIZE = 250;
const STUDENT_IMPORT_BATCH_SIZE = 250;
const pendingAccountTable = `CREATE TABLE IF NOT EXISTS pending_account_imports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account_type VARCHAR(30) NOT NULL,
  school_id VARCHAR(40) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  encrypted_password TEXT NULL,
  password_iv VARCHAR(50) NULL,
  password_auth_tag VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY pending_account_identity (account_type, school_id)
)`;

export async function attachPendingAccounts(connection) {
  for (const [type, config] of Object.entries(TYPES)) {
    if (!config.table || !config.column) continue;
    await connection.query(
      `INSERT INTO ${config.table} (student_id, ${config.column}, encrypted_password, password_iv, password_auth_tag, is_active)
       SELECT s.id, p.account_name, p.encrypted_password, p.password_iv, p.password_auth_tag, 1
         FROM pending_account_imports p JOIN students s ON s.student_id=p.school_id
        WHERE p.account_type=?
       ON DUPLICATE KEY UPDATE ${config.column}=VALUES(${config.column}), encrypted_password=VALUES(encrypted_password), password_iv=VALUES(password_iv), password_auth_tag=VALUES(password_auth_tag), is_active=1`,
      [type],
    );
    await connection.query(
      "DELETE p FROM pending_account_imports p JOIN students s ON s.student_id=p.school_id WHERE p.account_type=?",
      [type],
    );
  }
}

const cleanRow = (source) =>
  Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key.replace(/^\uFEFF/, "").trim(),
      String(value ?? "").trim(),
    ]),
  );

const normalizeColumnName = (value) =>
  String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

// Imports may originate from the registrar system as well as from the supplied
// template. Match familiar header variants without changing the exported error
// report's original columns.
const rowValue = (row, ...aliases) => {
  const accepted = new Set(aliases.map(normalizeColumnName));
  const key = Object.keys(row).find((column) =>
    accepted.has(normalizeColumnName(column)),
  );
  return key === undefined ? "" : String(row[key] ?? "").trim();
};

const safeExportValue = (value) => {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const buildErrorReport = async (rows, errors) => {
  if (!errors.length) return null;
  const messages = new Map();
  errors.forEach((error) =>
    messages.set(
      error.row,
      [...(messages.get(error.row) || []), error.message].join("; "),
    ),
  );
  const reportRows = rows
    .map((row, index) => ({
      ...Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          safeExportValue(value),
        ]),
      ),
      Error: messages.get(index + 2),
    }))
    .filter((row) => row.Error);
  return workbookBase64(reportRows, "Import errors");
};

async function readRows(file) {
  if (!file)
    throw Object.assign(new Error("Choose a CSV or XLSX file."), {
      status: 400,
    });
  try {
    const rows = (await readWorkbookRows(file.buffer, file.originalname)).map(
      cleanRow,
    );
    if (!rows.length)
      throw Object.assign(new Error("The uploaded file has no data rows."), {
        status: 400,
      });
    return rows;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("The uploaded file could not be read."), {
      status: 400,
    });
  }
}

function typeFor(req) {
  const config = TYPES[req.params.type];
  if (!config)
    throw Object.assign(new Error("Unsupported import type."), { status: 404 });
  return config;
}

export async function downloadImportTemplate(req, res) {
  try {
    const config = typeFor(req);
    const file = await workbookBuffer([config.sample], config.label);
    res
      .set({
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${req.params.type}-import-template.xlsx"`,
        "Cache-Control": "no-store",
      })
      .send(file);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
}

export async function exportAccountCredentials(req, res) {
  try {
    const sheets = [];
    const accountTypes = Object.values(TYPES).filter(
      (config) => config.table && config.column,
    );
    for (const config of accountTypes) {
      const [rows] = await pool.query(
        `SELECT s.student_id, s.kumosoft_id, s.last_name, s.first_name, s.middle_name,
                c.code AS course_code, a.${config.column} AS account_name,
                a.encrypted_password, a.password_iv, a.password_auth_tag
           FROM ${config.table} a
           JOIN students s ON s.id=a.student_id
           JOIN courses c ON c.id=s.course_id
          WHERE a.is_active=1
          ORDER BY s.last_name, s.first_name, s.student_id`,
      );
      const exportRows = rows.map((row) => ({
        SchoolID: row.student_id,
        ...(config.requiresKumosoftId
          ? { KumosoftID: row.account_name }
          : {
              [config.column === "email_address" ? "EmailAddress" : "Username"]:
                row.account_name,
            }),
        LastName: row.last_name,
        FirstName: row.first_name,
        MiddleName: row.middle_name || "",
        CourseCode: row.course_code,
        Password: decryptPassword(row),
      }));
      sheets.push({ rows: exportRows, name: config.label });
    }
    // Account imports can arrive before the student import. Keep those
    // records visible in the credential export instead of silently omitting
    // them just because they are waiting for a matching School ID.
    let unmatchedRows = [];
    try {
      const [pending] = await pool.query(
        `SELECT account_type, school_id, account_name,
                encrypted_password, password_iv, password_auth_tag,
                created_at
           FROM pending_account_imports
          ORDER BY account_type, school_id`,
      );
      unmatchedRows = pending.map((row) => {
        const config = TYPES[row.account_type];
        const accountColumn = config?.requiresKumosoftId
          ? "KumosoftID"
          : config?.column === "email_address"
            ? "EmailAddress"
            : "Username";
        return {
          AccountType: config?.label || row.account_type,
          SchoolID: row.school_id,
          [accountColumn]: row.account_name,
          Password: decryptPassword(row) || "",
          Status: "Unmatched - waiting for student import",
          ImportedAt: row.created_at
            ? new Date(row.created_at).toISOString()
            : "",
        };
      });
    } catch (error) {
      // Older deployments that have never imported an unmatched account may
      // not have this optional holding table yet; their regular export stays
      // available and simply has no unmatched-account sheet.
      if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    }
    if (unmatchedRows.length) {
      sheets.push({ rows: unmatchedRows, name: "Unmatched accounts" });
    }
    res
      .set({
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          "attachment; filename=credential-account-export.xlsx",
        "Cache-Control": "no-store",
      })
      .send(await multiSheetWorkbookBuffer(sheets));
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : "Credential export could not be completed.",
    });
  }
}

export async function reviewStudentRows(rows, executor = pool) {
  const [courses] = await executor.query(
    "SELECT id, code FROM courses WHERE is_active=1",
  );
  const courseMap = new Map(
    courses.map((course) => [course.code.toUpperCase(), course.id]),
  );
  const [existingRows] = await executor.query(
    "SELECT id, student_id, kumosoft_id FROM students",
  );
  const existing = new Map(
    existingRows.map((student) => [student.student_id, student.id]),
  );
  const kumosoftOwnerMap = new Map(
    existingRows
      .filter((student) => student.kumosoft_id)
      .map((student) => [student.kumosoft_id, student.student_id]),
  );
  const seen = new Set(),
    seenKumosoftIds = new Set(),
    errors = [],
    items = [];
  rows.forEach((row, index) => {
    const schoolId = rowValue(row, "SchoolID", "StudentID", "ID", "EISID");
    const kumosoftId = rowValue(row, "KumosoftID", "Kumosoft Id") || null;
    const firstName = rowValue(row, "FirstName", "GivenName");
    const middleName = rowValue(row, "MiddleName", "MiddleInitial");
    const lastName = rowValue(row, "LastName", "Surname");
    const birthDate = rowValue(row, "BirthDate", "Birthday", "DateOfBirth");
    const courseCode = rowValue(row, "CourseCode", "Course").toUpperCase();
    const rowNumber = index + 2;
    if (
      !schoolId ||
      !firstName ||
      !lastName ||
      !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
      !courseCode
    )
      return errors.push({
        row: rowNumber,
        message:
          "SchoolID, FirstName, LastName, BirthDate (YYYY-MM-DD), and CourseCode are required.",
      });
    if (!courseMap.has(courseCode))
      return errors.push({
        row: rowNumber,
        message: `Active course ${courseCode} was not found.`,
      });
    if (seen.has(schoolId))
      return errors.push({
        row: rowNumber,
        message: `Duplicate SchoolID ${schoolId} in file.`,
      });
    if (kumosoftId && seenKumosoftIds.has(kumosoftId))
      return errors.push({
        row: rowNumber,
        message: `Duplicate KumosoftID ${kumosoftId} in file.`,
      });
    if (
      kumosoftId &&
      kumosoftOwnerMap.has(kumosoftId) &&
      kumosoftOwnerMap.get(kumosoftId) !== schoolId
    )
      return errors.push({
        row: rowNumber,
        message: `KumosoftID ${kumosoftId} is already assigned to SchoolID ${kumosoftOwnerMap.get(kumosoftId)}.`,
      });
    seen.add(schoolId);
    if (kumosoftId) seenKumosoftIds.add(kumosoftId);
    items.push({
      row: rowNumber,
      schoolId,
      kumosoftId,
      firstName,
      middleName: middleName || null,
      lastName,
      birthDate,
      courseId: courseMap.get(courseCode),
      courseCode,
      status: existing.has(schoolId) ? "update" : "new",
      id: existing.get(schoolId),
    });
  });
  return { items, errors };
}

async function reviewStudentDeactivation(rows, executor = pool) {
  const [students] = await executor.query("SELECT student_id FROM students");
  const existing = new Set(students.map((student) => student.student_id));
  const seen = new Set(),
    errors = [],
    items = [];
  rows.forEach((row, index) => {
    const schoolId = rowValue(row, "SchoolID", "StudentID", "ID", "EISID");
    const rowNumber = index + 2;
    if (!schoolId)
      return errors.push({ row: rowNumber, message: "SchoolID is required." });
    if (seen.has(schoolId))
      return errors.push({
        row: rowNumber,
        message: `Duplicate SchoolID ${schoolId} in file.`,
      });
    seen.add(schoolId);
    if (!existing.has(schoolId))
      return errors.push({
        row: rowNumber,
        message: `Student ${schoolId} was not found.`,
      });
    items.push({ row: rowNumber, schoolId, status: "new" });
  });
  return { items, errors };
}

async function reviewAccounts(rows, config, executor = pool) {
  const [students] = await executor.query(
    "SELECT id, student_id, kumosoft_id FROM students",
  );
  const studentMap = new Map(
    students.map((student) => [student.student_id, student.id]),
  );
  const kumosoftOwnerMap = new Map(
    students
      .filter((student) => student.kumosoft_id)
      .map((student) => [student.kumosoft_id, student.student_id]),
  );
  const [accounts] = await executor.query(
    `SELECT student_id, ${config.column} AS account_name FROM ${config.table}`,
  );
  const existing = new Set(
    accounts.map((account) => Number(account.student_id)),
  );
  const accountOwnerMap = new Map(
    accounts.map((account) => [
      String(account.account_name),
      Number(account.student_id),
    ]),
  );
  const seen = new Set(),
    seenKumosoftIds = new Set(),
    errors = [],
    items = [];
  rows.forEach((row, index) => {
    const schoolId = rowValue(row, "SchoolID", "StudentID", "ID", "EISID");
    const password = rowValue(
      row,
      "Password",
      "SATPPassword",
      "SchoologyPassword",
      "KumosoftPassword",
      "EmailPassword",
    );
    const emailAddress = rowValue(row, "EmailAddress", "Email").toLowerCase();
    const kumosoftId = rowValue(row, "KumosoftID", "Kumosoft Id");
    const rowNumber = index + 2;
    if (!schoolId || (!password && !config.allowEmptyPassword))
      return errors.push({
        row: rowNumber,
        message: config.allowEmptyPassword
          ? "SchoolID (or StudentID/ID) is required. Password may be empty."
          : "SchoolID (or StudentID/ID) and Password are required.",
      });
    if (config.requiresKumosoftId && !kumosoftId)
      return errors.push({
        row: rowNumber,
        message: "KumosoftID is required for a Kumosoft account.",
      });
    const studentId = studentMap.get(schoolId);
    if (
      config.column === "email_address" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)
    )
      return errors.push({
        row: rowNumber,
        message: "Enter a valid EmailAddress.",
      });
    if (seen.has(schoolId))
      return errors.push({
        row: rowNumber,
        message: `Duplicate SchoolID ${schoolId} in file.`,
      });
    if (config.requiresKumosoftId && seenKumosoftIds.has(kumosoftId))
      return errors.push({
        row: rowNumber,
        message: `Duplicate KumosoftID ${kumosoftId} in file.`,
      });
    if (
      config.requiresKumosoftId &&
      kumosoftOwnerMap.has(kumosoftId) &&
      kumosoftOwnerMap.get(kumosoftId) !== schoolId
    )
      return errors.push({
        row: rowNumber,
        message: `KumosoftID ${kumosoftId} is already assigned to SchoolID ${kumosoftOwnerMap.get(kumosoftId)}.`,
      });
    if (
      config.requiresKumosoftId &&
      accountOwnerMap.has(kumosoftId) &&
      accountOwnerMap.get(kumosoftId) !== Number(studentId)
    )
      return errors.push({
        row: rowNumber,
        message: `KumosoftID ${kumosoftId} is already linked to another student account.`,
      });
    seen.add(schoolId);
    if (config.requiresKumosoftId) seenKumosoftIds.add(kumosoftId);
    items.push({
      row: rowNumber,
      schoolId,
      studentId,
      password: password || null,
      kumosoftId,
      login:
        config.column === "email_address"
          ? emailAddress
          : config.requiresKumosoftId
            ? kumosoftId
            : schoolId,
      status: studentId && existing.has(Number(studentId)) ? "update" : "new",
    });
  });
  return { items, errors };
}

async function review(type, file, executor = pool) {
  const config = TYPES[type];
  if (!config)
    throw Object.assign(new Error("Unsupported import type."), { status: 404 });
  const rows = await readRows(file);
  const result =
    type === "students"
      ? await reviewStudentRows(rows, executor)
      : type === "student-deactivate"
        ? await reviewStudentDeactivation(rows, executor)
        : await reviewAccounts(rows, config, executor);
  return {
    ...result,
    rows,
    total: rows.length,
    new: result.items.filter((item) => item.status === "new").length,
    update: result.items.filter((item) => item.status === "update").length,
  };
}

export async function upsertStudentRows(items, connection) {
  for (
    let start = 0;
    start < items.length;
    start += STUDENT_IMPORT_BATCH_SIZE
  ) {
    const batch = items.slice(start, start + STUDENT_IMPORT_BATCH_SIZE);
    const values = [];
    const placeholders = batch.map((item) => {
      values.push(
        item.schoolId,
        item.kumosoftId,
        item.firstName,
        item.middleName,
        item.lastName,
        item.birthDate,
        item.courseId,
      );
      return "(?, ?, ?, ?, ?, ?, ?, 1)";
    });
    await connection.query(
      `INSERT INTO students (student_id, kumosoft_id, first_name, middle_name, last_name, birth_date, course_id, is_active)
       VALUES ${placeholders.join(", ")}
       ON DUPLICATE KEY UPDATE kumosoft_id=COALESCE(VALUES(kumosoft_id), kumosoft_id), first_name=VALUES(first_name), middle_name=VALUES(middle_name), last_name=VALUES(last_name), birth_date=VALUES(birth_date), course_id=VALUES(course_id), is_active=1`,
      values,
    );
  }
  await attachPendingAccounts(connection);
}

export async function validateDataImport(req, res) {
  try {
    const result = await review(req.params.type, req.file);
    res.json({
      total: result.total,
      new: result.new,
      update: result.update,
      unchanged: 0,
      invalid: result.errors.length,
      errors: result.errors,
      errorReport: await buildErrorReport(result.rows, result.errors),
      preview: result.items.slice(0, 20).map(({ password, ...item }) => item),
    });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ message: error.message || "Import validation failed." });
  }
}

export async function importData(req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.query(pendingAccountTable);
    await connection.beginTransaction();
    const config = TYPES[req.params.type];
    const result = await review(req.params.type, req.file, connection);
    if (!result.items.length) {
      await connection.rollback();
      return res.status(400).json({
        message: "No valid rows are available to import.",
        errors: result.errors,
        errorReport: await buildErrorReport(result.rows, result.errors),
      });
    }
    if (req.params.type === "students") {
      await upsertStudentRows(result.items, connection);
    } else if (req.params.type === "student-deactivate") {
      await connection.query(
        `UPDATE students SET is_active=0 WHERE student_id IN (${result.items.map(() => "?").join(", ")})`,
        result.items.map((item) => item.schoolId),
      );
    } else {
      const attachedItems = result.items.filter((item) => item.studentId);
      const pendingItems = result.items.filter((item) => !item.studentId);
      for (
        let start = 0;
        start < attachedItems.length;
        start += ACCOUNT_IMPORT_BATCH_SIZE
      ) {
        const batch = attachedItems.slice(
          start,
          start + ACCOUNT_IMPORT_BATCH_SIZE,
        );
        const values = [];
        const placeholders = batch.map((item) => {
          const encrypted =
            item.password === null
              ? {
                  encrypted_password: null,
                  password_iv: null,
                  password_auth_tag: null,
                }
              : encryptPassword(item.password);
          values.push(
            item.studentId,
            item.login,
            encrypted.encrypted_password,
            encrypted.password_iv,
            encrypted.password_auth_tag,
          );
          return "(?, ?, ?, ?, ?, 1)";
        });
        await connection.query(
          `INSERT INTO ${config.table} (student_id, ${config.column}, encrypted_password, password_iv, password_auth_tag, is_active)
           VALUES ${placeholders.join(", ")}
           ON DUPLICATE KEY UPDATE ${config.column}=VALUES(${config.column}), encrypted_password=VALUES(encrypted_password), password_iv=VALUES(password_iv), password_auth_tag=VALUES(password_auth_tag), is_active=1`,
          values,
        );
        if (config.requiresKumosoftId)
          await Promise.all(
            batch.map((item) =>
              connection.query("UPDATE students SET kumosoft_id=? WHERE id=?", [
                item.kumosoftId,
                item.studentId,
              ]),
            ),
          );
      }
      for (
        let start = 0;
        start < pendingItems.length;
        start += ACCOUNT_IMPORT_BATCH_SIZE
      ) {
        const batch = pendingItems.slice(
          start,
          start + ACCOUNT_IMPORT_BATCH_SIZE,
        );
        const values = [];
        const placeholders = batch.map((item) => {
          const encrypted =
            item.password === null
              ? {
                  encrypted_password: null,
                  password_iv: null,
                  password_auth_tag: null,
                }
              : encryptPassword(item.password);
          values.push(
            req.params.type,
            item.schoolId,
            item.login,
            encrypted.encrypted_password,
            encrypted.password_iv,
            encrypted.password_auth_tag,
          );
          return "(?, ?, ?, ?, ?, ?)";
        });
        await connection.query(
          `INSERT INTO pending_account_imports (account_type, school_id, account_name, encrypted_password, password_iv, password_auth_tag)
           VALUES ${placeholders.join(", ")}
           ON DUPLICATE KEY UPDATE account_name=VALUES(account_name), encrypted_password=VALUES(encrypted_password), password_iv=VALUES(password_iv), password_auth_tag=VALUES(password_auth_tag)`,
          values,
        );
      }
    }
    await connection.commit();
    res.json({
      inserted: result.new,
      deactivated:
        req.params.type === "student-deactivate"
          ? result.items.length
          : undefined,
      updated: result.update,
      total: result.total,
      invalid: result.errors.length,
      pending: result.items.filter((item) => !item.studentId).length,
      errors: result.errors,
      errorReport: await buildErrorReport(result.rows, result.errors),
    });
  } catch (error) {
    await connection.rollback();
    res
      .status(error.status || 500)
      .json({ message: error.message || "Import failed." });
  } finally {
    connection.release();
  }
}
