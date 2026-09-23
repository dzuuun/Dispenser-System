import { pool } from "../config/db.js";
import {
  readWorkbookRows,
  workbookBase64,
} from "../services/workbook.service.js";

const safeExportValue = (value) => {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const buildErrorReport = async (rows, errors) => {
  if (!errors.length) return null;
  const messages = new Map(errors.map((error) => [error.row, error.message]));
  return workbookBase64(
    rows
      .map((row, index) => ({
        ...Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            safeExportValue(value),
          ]),
        ),
        Error: messages.get(index + 2),
      }))
      .filter((row) => row.Error),
    "Import errors",
  );
};

export async function listCourses(_req, res) {
  const [rows] = await pool.query(
    "SELECT c.id, c.code, c.name, c.is_active, COUNT(s.id) student_count FROM courses c LEFT JOIN students s ON s.course_id=c.id GROUP BY c.id ORDER BY c.code",
  );
  res.json(rows);
}
export async function createCourse(req, res) {
  const code = String(req.body.code || "")
    .trim()
    .toUpperCase();
  const name = String(req.body.name || "").trim();
  const isActive = req.body.isActive === false ? 0 : 1;
  if (!code || !name)
    return res
      .status(400)
      .json({ message: "Course code and course name are required." });
  try {
    const [created] = await pool.execute(
      "INSERT INTO courses (code, name, is_active) VALUES (?, ?, ?)",
      [code, name, isActive],
    );
    res
      .status(201)
      .json({ id: created.insertId, code, name, is_active: Boolean(isActive) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That course code already exists." });
    throw error;
  }
}
export async function updateCourse(req, res) {
  const code = String(req.body.code || "")
    .trim()
    .toUpperCase();
  const name = String(req.body.name || "").trim();
  const isActive = req.body.isActive === false ? 0 : 1;
  if (!code || !name)
    return res
      .status(400)
      .json({ message: "Course code and course name are required." });
  try {
    const [updated] = await pool.execute(
      "UPDATE courses SET code = ?, name = ?, is_active = ? WHERE id = ?",
      [code, name, isActive, req.params.id],
    );
    if (!updated.affectedRows)
      return res.status(404).json({ message: "Course not found." });
    res.json({
      id: Number(req.params.id),
      code,
      name,
      is_active: Boolean(isActive),
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That course code already exists." });
    throw error;
  }
}
async function readImportRows(file) {
  if (!file) {
    const error = new Error("Choose a CSV or XLSX file.");
    error.status = 400;
    throw error;
  }
  let rows;
  try {
    rows = await readWorkbookRows(file.buffer, file.originalname);
  } catch {
    const error = new Error("The uploaded file could not be read.");
    error.status = 400;
    throw error;
  }
  if (!rows.length) {
    const error = new Error("The uploaded file has no data rows.");
    error.status = 400;
    throw error;
  }
  const valid = [],
    sourceRows = [],
    errors = [],
    seen = new Set();
  rows.forEach((sourceRow, index) => {
    const row = Object.fromEntries(
      Object.entries(sourceRow).map(([key, value]) => [
        key.replace(/^\uFEFF/, "").trim(),
        value,
      ]),
    );
    sourceRows.push(row);
    const code = String(row.CourseCode || row.Code || row.course_code || "")
      .trim()
      .toUpperCase();
    const name = String(
      row.CourseName || row.Name || row.course_name || "",
    ).trim();
    if (!code || !name)
      return errors.push({
        row: index + 2,
        message: "CourseCode and CourseName are required.",
      });
    if (seen.has(code))
      return errors.push({
        row: index + 2,
        message: `Duplicate course code ${code} in file.`,
      });
    seen.add(code);
    valid.push({ row: index + 2, code, name });
  });
  return { total: rows.length, valid, errors, sourceRows };
}

async function classifyImport(file, executor = pool) {
  const parsed = await readImportRows(file);
  const codes = parsed.valid.map((item) => item.code);
  const existing = new Map();
  if (codes.length) {
    const placeholders = codes.map(() => "?").join(",");
    const [records] = await executor.execute(
      `SELECT id, code, name FROM courses WHERE code IN (${placeholders})`,
      codes,
    );
    records.forEach((record) => existing.set(record.code, record));
  }
  const items = parsed.valid.map((item) => {
    const record = existing.get(item.code);
    const status = !record
      ? "new"
      : record.name.trim().toLowerCase() === item.name.trim().toLowerCase()
        ? "unchanged"
        : "update";
    return { ...item, status, id: record?.id };
  });
  const counts = items.reduce(
    (total, item) => ({ ...total, [item.status]: total[item.status] + 1 }),
    { new: 0, update: 0, unchanged: 0 },
  );
  return { ...parsed, items, ...counts };
}

export async function validateCourseImport(req, res) {
  try {
    const result = await classifyImport(req.file);
    res.json({
      total: result.total,
      new: result.new,
      update: result.update,
      unchanged: result.unchanged,
      invalid: result.errors.length,
      errors: result.errors,
      errorReport: await buildErrorReport(result.sourceRows, result.errors),
      preview: result.items,
    });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ message: error.message || "Course validation failed." });
  }
}

export async function importCourses(req, res) {
  let connection;
  if (!req.file)
    return res.status(400).json({ message: "Choose a CSV or XLSX file." });
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const result = await classifyImport(req.file, connection);
    let inserted = 0,
      updated = 0;
    for (const item of result.items) {
      if (item.status === "new") {
        await connection.execute(
          "INSERT INTO courses (code, name, is_active) VALUES (?, ?, 1)",
          [item.code, item.name],
        );
        inserted++;
      }
      if (item.status === "update") {
        await connection.execute("UPDATE courses SET name = ? WHERE id = ?", [
          item.name,
          item.id,
        ]);
        updated++;
      }
    }
    await connection.commit();
    res.json({
      total: result.total,
      inserted,
      updated,
      unchanged: result.unchanged,
      invalid: result.errors.length,
      errors: result.errors,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    res
      .status(error.status || 500)
      .json({ message: error.message || "Course import failed." });
  } finally {
    connection?.release();
  }
}
