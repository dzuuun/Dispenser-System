import sql from "mssql";
import { config } from "../config/env.js";
import { pool } from "../config/db.js";
import { currentAcademicPeriod } from "../services/academic-period.service.js";
import {
  reviewStudentRows,
  upsertStudentRows,
} from "./bulk-import.controller.js";

const requiredColumns = [
  "SchoolID",
  "LastName",
  "FirstName",
  "MiddleName",
  "BirthDate",
  "CourseCode",
];

const viewName = () => {
  const value = config().mssql.view;
  const parts = value.split(".");
  if (
    parts.length !== 2 ||
    parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))
  )
    throw Object.assign(
      new Error(
        "Set MSSQL_STUDENT_VIEW to a trusted two-part view name, for example dbo.vw_CredentialsDispenserStudents.",
      ),
      { status: 500 },
    );
  return parts.map((part) => `[${part}]`).join(".");
};

const normalizeValue = (value) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? "").trim();

const importPeriod = async () => {
  const active = await currentAcademicPeriod();
  const schoolYear = String(active?.school_year || "").trim();
  const term = String(active?.semester || "").trim();
  const semester = {
    "first semester": 1,
    "first term": 1,
    "second semester": 2,
    "second term": 2,
    summer: 3,
    "third term": 3,
  }[term.toLowerCase()];
  if (!/^\d{4}-\d{4}$/.test(schoolYear) || !semester)
    throw Object.assign(
      new Error(
        "Activate an academic period with a supported term before importing enrolled students.",
      ),
      { status: 400 },
    );
  return { schoolYear, semester, term };
};

async function readMssqlStudents(period) {
  const settings = config().mssql;
  if (
    !settings.server ||
    !settings.database ||
    !settings.user ||
    !settings.password
  )
    throw Object.assign(
      new Error(
        "Configure MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, and MSSQL_PASSWORD before using the SQL Server student import.",
      ),
      { status: 503 },
    );
  let connection;
  try {
    connection = await new sql.ConnectionPool({
      server: settings.server,
      port: settings.port,
      database: settings.database,
      user: settings.user,
      password: settings.password,
      options: {
        encrypt: settings.encrypt,
        trustServerCertificate: settings.trustServerCertificate,
      },
      connectionTimeout: 15000,
      requestTimeout: 60000,
    }).connect();
  } catch (error) {
    const message =
      error.code === "ELOGIN"
        ? "Unable to sign in to SQL Server. Verify MSSQL_USER and MSSQL_PASSWORD before importing students."
        : "Unable to reach the configured SQL Server. Verify its host, TCP/IP port, and firewall access before importing students.";
    throw Object.assign(new Error(message), { status: 503, cause: error });
  }
  try {
    const request = connection
      .request()
      .input("schoolYear", sql.VarChar(20), period.schoolYear)
      .input("semester", sql.Int, period.semester);
    const result = await request.query(
      `SELECT [SchoolID], [LastName], [FirstName], [MiddleName], [BirthDate], [CourseCode]
       FROM ${viewName()}
       WHERE [SchoolYear]=@schoolYear AND [Semester]=@semester
       ORDER BY [LastName], [FirstName], [MiddleName], [SchoolID]`,
    );
    return result.recordset.map((row) =>
      Object.fromEntries(
        requiredColumns.map((column) => [column, normalizeValue(row[column])]),
      ),
    );
  } finally {
    await connection.close();
  }
}

const summary = (result) => ({
  total: result.items.length + result.errors.length,
  new: result.items.filter((item) => item.status === "new").length,
  update: result.items.filter((item) => item.status === "update").length,
  invalid: result.errors.length,
  errors: result.errors.slice(0, 50),
});

const previewRecords = (result) =>
  [
    ...result.items.map((item) => ({
      kind: item.status,
      row: item.row,
      schoolId: item.schoolId,
      name: [item.lastName, item.firstName, item.middleName]
        .filter(Boolean)
        .join(", "),
      courseCode: item.courseCode,
      message:
        item.status === "new"
          ? "Student will be created."
          : "Student record will be updated.",
    })),
    ...result.errors.map((item) => ({
      kind: "error",
      row: item.row,
      message: item.message,
    })),
  ].sort((left, right) => left.row - right.row);

const previewPage = (records, offset) => {
  const limit = 250;
  return {
    records: records.slice(offset, offset + limit),
    recordTotal: records.length,
    nextOffset: Math.min(offset + limit, records.length),
    hasMore: offset + limit < records.length,
  };
};

const previewGroups = (result) =>
  Object.fromEntries(
    ["new", "update", "error"].map((kind) => [
      kind,
      previewPage(
        previewRecords(result).filter((record) => record.kind === kind),
        0,
      ),
    ]),
  );

const previewOffset = (value) => {
  const offset = Number(value);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
};

const sourceStudentIds = (rows) => [
  ...new Set(
    rows.map((row) => String(row.SchoolID || "").trim()).filter(Boolean),
  ),
];

async function countStudentsToDeactivate(ids, executor = pool) {
  const [activeStudents] = await executor.query(
    "SELECT student_id FROM students WHERE is_active=1",
  );
  const sourceIds = new Set(ids);
  return activeStudents.filter((student) => !sourceIds.has(student.student_id))
    .length;
}

async function deactivateStudentsMissingFromSource(ids, connection) {
  try {
    await connection.query(
      `CREATE TEMPORARY TABLE import_mssql_student_ids (
        student_id VARCHAR(40) NOT NULL PRIMARY KEY
      )`,
    );
    for (let start = 0; start < ids.length; start += 500) {
      const batch = ids.slice(start, start + 500);
      await connection.query(
        `INSERT IGNORE INTO import_mssql_student_ids (student_id)
         VALUES ${batch.map(() => "(?)").join(", ")}`,
        batch,
      );
    }
    const [result] = await connection.query(
      `UPDATE students s
       LEFT JOIN import_mssql_student_ids source ON source.student_id=s.student_id
       SET s.is_active=0
       WHERE s.is_active=1 AND source.student_id IS NULL`,
    );
    return result.affectedRows;
  } finally {
    await connection.query(
      "DROP TEMPORARY TABLE IF EXISTS import_mssql_student_ids",
    );
  }
}

export async function previewMssqlStudentImport(req, res, next) {
  try {
    const period = await importPeriod();
    const rows = await readMssqlStudents(period);
    const result = await reviewStudentRows(rows);
    const offset = previewOffset(req.query.offset);
    const category = String(req.query.category || "");
    if (category && !["new", "update", "error"].includes(category))
      return res.status(400).json({ message: "Invalid preview category." });
    const deactivate =
      !category && offset === 0
        ? await countStudentsToDeactivate(sourceStudentIds(rows))
        : undefined;
    res.json({
      period,
      deactivate,
      ...summary(result),
      ...(category
        ? {
            category,
            page: previewPage(
              previewRecords(result).filter(
                (record) => record.kind === category,
              ),
              offset,
            ),
          }
        : { groups: previewGroups(result) }),
    });
  } catch (error) {
    next(error);
  }
}

export async function importMssqlStudents(req, res, next) {
  let connection;
  try {
    const period = await importPeriod();
    const rows = await readMssqlStudents(period);
    const sourceIds = sourceStudentIds(rows);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const result = await reviewStudentRows(rows, connection);
    if (!result.items.length) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "No valid student rows are available from the SQL Server view.",
        ...summary(result),
      });
    }
    const pendingDeactivations = await countStudentsToDeactivate(
      sourceIds,
      connection,
    );
    if (pendingDeactivations && req.body?.confirmDeactivation !== true) {
      await connection.rollback();
      return res.status(409).json({
        message: `Confirmation is required before deactivating ${pendingDeactivations} student${pendingDeactivations === 1 ? "" : "s"}.`,
        deactivated: pendingDeactivations,
      });
    }
    await upsertStudentRows(result.items, connection);
    const deactivated = await deactivateStudentsMissingFromSource(
      sourceIds,
      connection,
    );
    await connection.commit();
    res.json({
      message: `${result.items.length} student${result.items.length === 1 ? "" : "s"} imported from SQL Server; ${deactivated} student${deactivated === 1 ? "" : "s"} deactivated because they are not enrolled this semester.`,
      period,
      inserted: result.items.filter((item) => item.status === "new").length,
      updated: result.items.filter((item) => item.status === "update").length,
      deactivated,
      invalid: result.errors.length,
      errors: result.errors.slice(0, 50),
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}
