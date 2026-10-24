import { pool } from "../config/db.js";
import {
  importPreview,
  importErrorPreview,
  importChange,
} from "../services/import-preview.service.js";
import {
  inferAcademicLevel,
  normalizeAcademicLevel,
} from "../services/course-level.service.js";
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
    "SELECT c.id, c.code, c.name, c.academic_level, c.is_active, COUNT(s.id) student_count FROM courses c LEFT JOIN students s ON s.course_id=c.id GROUP BY c.id ORDER BY c.code",
  );
  res.json(rows);
}
export async function createCourse(req, res) {
  const code = String(req.body.code || "")
    .trim()
    .toUpperCase();
  const name = String(req.body.name || "").trim();
  const isActive = req.body.isActive === false ? 0 : 1;
  const academicLevel =
    req.body.academicLevel === undefined
      ? inferAcademicLevel(code, name)
      : normalizeAcademicLevel(req.body.academicLevel);
  if (!academicLevel)
    return res.status(400).json({
      message:
        "Choose College, Graduate school, or Other as the academic level.",
    });
  if (!code || !name)
    return res
      .status(400)
      .json({ message: "Course code and course name are required." });
  try {
    const [created] = await pool.execute(
      "INSERT INTO courses (code, name, academic_level, is_active) VALUES (?, ?, ?, ?)",
      [code, name, academicLevel, isActive],
    );
    res.status(201).json({
      id: created.insertId,
      code,
      name,
      academic_level: academicLevel,
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
export async function updateCourse(req, res) {
  const code = String(req.body.code || "")
    .trim()
    .toUpperCase();
  const name = String(req.body.name || "").trim();
  const isActive = req.body.isActive === false ? 0 : 1;
  const academicLevel =
    req.body.academicLevel === undefined
      ? null
      : normalizeAcademicLevel(req.body.academicLevel);
  if (req.body.academicLevel !== undefined && !academicLevel)
    return res.status(400).json({
      message:
        "Choose College, Graduate school, or Other as the academic level.",
    });
  if (!code || !name)
    return res
      .status(400)
      .json({ message: "Course code and course name are required." });
  try {
    const [updated] = await pool.execute(
      "UPDATE courses SET code = ?, name = ?, academic_level=COALESCE(?, academic_level), is_active = ? WHERE id = ?",
      [code, name, academicLevel, isActive, req.params.id],
    );
    if (!updated.affectedRows)
      return res.status(404).json({ message: "Course not found." });
    res.json({
      id: Number(req.params.id),
      code,
      name,
      academic_level: academicLevel ?? undefined,
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
    const levelInput = String(
      row.AcademicLevel || row.academic_level || row["Academic Level"] || "",
    ).trim();
    const academicLevel = levelInput
      ? normalizeAcademicLevel(levelInput)
      : null;
    if (levelInput && !academicLevel)
      return errors.push({
        row: index + 2,
        message: "AcademicLevel must be College, Graduate school, or Other.",
      });
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
    valid.push({ row: index + 2, code, name, academicLevel });
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
      `SELECT id, code, name, academic_level FROM courses WHERE code IN (${placeholders})`,
      codes,
    );
    records.forEach((record) =>
      existing.set(record.code.toUpperCase(), record),
    );
  }
  const items = parsed.valid.map((item) => {
    const record = existing.get(item.code);
    const academicLevel =
      item.academicLevel ||
      record?.academic_level ||
      inferAcademicLevel(item.code, item.name);
    const status = !record
      ? "new"
      : record.name === item.name && record.academic_level === academicLevel
        ? "unchanged"
        : "update";
    const levelLabel = (value) =>
      ({
        COLLEGE: "College",
        GRADUATE_SCHOOL: "Graduate school",
        OTHER: "Other",
      })[value] || value;
    const changes = record
      ? [
          importChange("Course name", record.name, item.name),
          importChange(
            "Academic level",
            levelLabel(record.academic_level),
            levelLabel(academicLevel),
          ),
        ].filter(Boolean)
      : [];
    return { ...item, academicLevel, status, id: record?.id, changes };
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
    const groups = {
      new: [],
      update: [],
      unchanged: [],
      error: importErrorPreview(result.errors),
    };
    for (const item of result.items)
      groups[item.status].push({
        row: item.row,
        changes: item.changes,
        label: `${item.code} — ${item.name}`,
        message:
          item.status === "new"
            ? "Course will be created."
            : item.status === "update"
              ? "Course will be updated."
              : "No changes required.",
      });
    const preview = importPreview(groups, req.query);
    if (preview.category) return res.json(preview);
    res.json({
      ...preview,
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
    for (const item of result.items.filter(
      (item) => item.status !== "unchanged",
    )) {
      await connection.query("SAVEPOINT import_row");
      try {
        if (item.status === "new") {
          await connection.execute(
            "INSERT INTO courses (code, name, academic_level, is_active) VALUES (?, ?, ?, 1)",
            [item.code, item.name, item.academicLevel],
          );
          inserted++;
        }
        if (item.status === "update") {
          await connection.execute(
            "UPDATE courses SET name = ?, academic_level=? WHERE id = ?",
            [item.name, item.academicLevel, item.id],
          );
          updated++;
        }
      } catch (error) {
        if (
          ![
            "ER_DUP_ENTRY",
            "ER_DATA_TOO_LONG",
            "ER_BAD_NULL_ERROR",
            "ER_WARN_DATA_OUT_OF_RANGE",
          ].includes(error.code)
        )
          throw error;
        await connection.query("ROLLBACK TO SAVEPOINT import_row");
        result.errors.push({
          row: item.row,
          message: `Could not import row (${error.code}).`,
        });
      }
      await connection.query("RELEASE SAVEPOINT import_row");
    }
    await connection.commit();
    res.json({
      total: result.total,
      inserted,
      updated,
      unchanged: result.unchanged,
      invalid: result.errors.length,
      errors: result.errors,
      errorReport: await buildErrorReport(result.sourceRows, result.errors),
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
