import XLSX from "xlsx";
import { pool } from "../config/db.js";
import { encryptPassword } from "../services/encryption.service.js";

const TYPES = {
  courses: { label: "Courses", sample: { CourseCode: "BSIT", CourseName: "Bachelor of Science in Information Technology" } },
  students: {
    label: "Students",
    sample: { SchoolID: "2026-00001", LastName: "Dela Cruz", FirstName: "Juan", MiddleName: "Santos", BirthDate: "2005-01-31", CourseCode: "BSIT" },
  },
  satp: { label: "SATP accounts", table: "satp_accounts", column: "username", sample: { SchoolID: "2026-00001", Password: "temporary-password" } },
  schoology: { label: "Schoology accounts", table: "schoology_accounts", column: "username", sample: { SchoolID: "2026-00001", Password: "temporary-password" } },
  kumosoft: { label: "Kumosoft accounts", table: "kumosoft_accounts", column: "username", sample: { SchoolID: "2026-00001", Password: "temporary-password" } },
  email: { label: "Institutional email accounts", table: "institutional_email_accounts", column: "email_address", sample: { SchoolID: "2026-00001", EmailAddress: "student@ndmu.edu.ph", Password: "temporary-password" } },
  vouchers: { label: "WiFi vouchers", sample: { VoucherCode: "WIFI-EXAMPLE-001" } },
};

const cleanRow = (source) => Object.fromEntries(
  Object.entries(source).map(([key, value]) => [key.replace(/^\uFEFF/, "").trim(), String(value ?? "").trim()]),
);

function readRows(file) {
  if (!file) throw Object.assign(new Error("Choose a CSV or XLSX file."), { status: 400 });
  try {
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }).map(cleanRow);
    if (!rows.length) throw Object.assign(new Error("The uploaded file has no data rows."), { status: 400 });
    return rows;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("The uploaded file could not be read."), { status: 400 });
  }
}

function typeFor(req) {
  const config = TYPES[req.params.type];
  if (!config) throw Object.assign(new Error("Unsupported import type."), { status: 404 });
  return config;
}

export function downloadImportTemplate(req, res) {
  try {
    const config = typeFor(req);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([config.sample]), config.label.slice(0, 31));
    const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${req.params.type}-import-template.xlsx"`,
      "Cache-Control": "no-store",
    }).send(file);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
}

async function reviewStudents(rows, executor = pool) {
  const [courses] = await executor.query("SELECT id, code FROM courses WHERE is_active=1");
  const courseMap = new Map(courses.map((course) => [course.code.toUpperCase(), course.id]));
  const [existingRows] = await executor.query("SELECT id, student_id FROM students");
  const existing = new Map(existingRows.map((student) => [student.student_id, student.id]));
  const seen = new Set(), errors = [], items = [];
  rows.forEach((row, index) => {
    const schoolId = String(row.SchoolID || row.StudentID || "").trim();
    const firstName = String(row.FirstName || "").trim();
    const middleName = String(row.MiddleName || "").trim();
    const lastName = String(row.LastName || "").trim();
    const birthDate = String(row.BirthDate || "").trim();
    const courseCode = String(row.CourseCode || "").trim().toUpperCase();
    const rowNumber = index + 2;
    if (!schoolId || !firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !courseCode)
      return errors.push({ row: rowNumber, message: "SchoolID, FirstName, LastName, BirthDate (YYYY-MM-DD), and CourseCode are required." });
    if (!courseMap.has(courseCode)) return errors.push({ row: rowNumber, message: `Active course ${courseCode} was not found.` });
    if (seen.has(schoolId)) return errors.push({ row: rowNumber, message: `Duplicate SchoolID ${schoolId} in file.` });
    seen.add(schoolId);
    items.push({ row: rowNumber, schoolId, firstName, middleName: middleName || null, lastName, birthDate, courseId: courseMap.get(courseCode), courseCode, status: existing.has(schoolId) ? "update" : "new", id: existing.get(schoolId) });
  });
  return { items, errors };
}

async function reviewAccounts(rows, config, executor = pool) {
  const [students] = await executor.query("SELECT id, student_id FROM students");
  const studentMap = new Map(students.map((student) => [student.student_id, student.id]));
  const [accounts] = await executor.query(`SELECT student_id FROM ${config.table}`);
  const existing = new Set(accounts.map((account) => Number(account.student_id)));
  const seen = new Set(), errors = [], items = [];
  rows.forEach((row, index) => {
    const schoolId = String(row.SchoolID || row.StudentID || "").trim();
    const password = String(row.Password || "");
    const emailAddress = String(row.EmailAddress || row.Email || "").trim().toLowerCase();
    const rowNumber = index + 2;
    if (!schoolId || !password) return errors.push({ row: rowNumber, message: "SchoolID and Password are required." });
    const studentId = studentMap.get(schoolId);
    if (!studentId) return errors.push({ row: rowNumber, message: `Student ${schoolId} was not found.` });
    if (config.column === "email_address" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress))
      return errors.push({ row: rowNumber, message: "Enter a valid EmailAddress." });
    if (seen.has(schoolId)) return errors.push({ row: rowNumber, message: `Duplicate SchoolID ${schoolId} in file.` });
    seen.add(schoolId);
    items.push({ row: rowNumber, schoolId, studentId, password, login: config.column === "email_address" ? emailAddress : schoolId, status: existing.has(Number(studentId)) ? "update" : "new" });
  });
  return { items, errors };
}

async function review(type, file, executor = pool) {
  const config = TYPES[type];
  if (!config) throw Object.assign(new Error("Unsupported import type."), { status: 404 });
  const rows = readRows(file);
  const result = type === "students" ? await reviewStudents(rows, executor) : await reviewAccounts(rows, config, executor);
  return {
    ...result,
    total: rows.length,
    new: result.items.filter((item) => item.status === "new").length,
    update: result.items.filter((item) => item.status === "update").length,
  };
}

export async function validateDataImport(req, res) {
  try {
    const result = await review(req.params.type, req.file);
    res.json({ total: result.total, new: result.new, update: result.update, unchanged: 0, invalid: result.errors.length, errors: result.errors, preview: result.items.slice(0, 20).map(({ password, ...item }) => item) });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || "Import validation failed." });
  }
}

export async function importData(req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const config = TYPES[req.params.type];
    const result = await review(req.params.type, req.file, connection);
    if (result.errors.length) {
      await connection.rollback();
      return res.status(400).json({ message: "Fix invalid rows before importing.", errors: result.errors });
    }
    if (req.params.type === "students") {
      for (const item of result.items) {
        await connection.execute(
          `INSERT INTO students (student_id, first_name, middle_name, last_name, birth_date, course_id, is_active)
           VALUES (?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE first_name=VALUES(first_name), middle_name=VALUES(middle_name), last_name=VALUES(last_name), birth_date=VALUES(birth_date), course_id=VALUES(course_id), is_active=1`,
          [item.schoolId, item.firstName, item.middleName, item.lastName, item.birthDate, item.courseId],
        );
      }
    } else {
      for (const item of result.items) {
        const encrypted = encryptPassword(item.password);
        await connection.execute(
          `INSERT INTO ${config.table} (student_id, ${config.column}, encrypted_password, password_iv, password_auth_tag, is_active)
           VALUES (?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE ${config.column}=VALUES(${config.column}), encrypted_password=VALUES(encrypted_password), password_iv=VALUES(password_iv), password_auth_tag=VALUES(password_auth_tag), is_active=1`,
          [item.studentId, item.login, encrypted.encrypted_password, encrypted.password_iv, encrypted.password_auth_tag],
        );
      }
    }
    await connection.commit();
    res.json({ inserted: result.new, updated: result.update, total: result.total, errors: [] });
  } catch (error) {
    await connection.rollback();
    res.status(error.status || 500).json({ message: error.message || "Import failed." });
  } finally {
    connection.release();
  }
}
