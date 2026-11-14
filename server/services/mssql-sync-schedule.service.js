import { pool } from "../config/db.js";
import { importMssqlStudents } from "../controllers/mssql-student-import.controller.js";

const LOCK_NAME = "dispenser_mssql_scheduled_sync";

export async function ensureMssqlSyncScheduleSchema(executor = pool) {
  await executor.query(`CREATE TABLE IF NOT EXISTS mssql_sync_schedule (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    interval_minutes INT UNSIGNED NOT NULL DEFAULT 1440,
    next_run_at DATETIME NULL,
    last_started_at DATETIME NULL,
    last_finished_at DATETIME NULL,
    last_status VARCHAR(16) NULL,
    last_message VARCHAR(1000) NULL
  )`);
  await executor.query(
    "INSERT IGNORE INTO mssql_sync_schedule (id) VALUES (1)",
  );
  await executor.query(`CREATE TABLE IF NOT EXISTS mssql_sync_activity (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NULL,
    status VARCHAR(16) NOT NULL,
    period_label VARCHAR(100) NULL,
    created_count INT UNSIGNED NULL,
    updated_count INT UNSIGNED NULL,
    unchanged_count INT UNSIGNED NULL,
    deactivated_count INT UNSIGNED NULL,
    invalid_count INT UNSIGNED NULL,
    message VARCHAR(1000) NULL,
    INDEX mssql_sync_activity_started (started_at, id),
    INDEX mssql_sync_activity_status (status)
  )`);
}

export async function listMssqlSyncActivity(req, res, next) {
  try {
    const page = Number(req.query.page ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
      return res.status(400).json({ message: "Choose a valid activity page." });
    const limit = 20;
    const [[count]] = await pool.query(
      "SELECT COUNT(*) total FROM mssql_sync_activity",
    );
    const [rows] = await pool.query(
      "SELECT id, started_at, finished_at, status, period_label, created_count, updated_count, unchanged_count, deactivated_count, invalid_count, message FROM mssql_sync_activity ORDER BY id DESC LIMIT ? OFFSET ?",
      [limit, (page - 1) * limit],
    );
    res
      .set("Cache-Control", "no-store")
      .json({
        rows,
        page,
        pages: Math.max(1, Math.ceil(Number(count.total) / limit)),
        total: Number(count.total),
      });
  } catch (error) {
    next(error);
  }
}

export async function getMssqlSyncSchedule(_req, res, next) {
  try {
    const [[row]] = await pool.query(
      "SELECT enabled, interval_minutes, next_run_at, last_started_at, last_finished_at, last_status, last_message FROM mssql_sync_schedule WHERE id=1",
    );
    res.json({ ...row, enabled: Boolean(row.enabled) });
  } catch (error) {
    next(error);
  }
}

export async function updateMssqlSyncSchedule(req, res, next) {
  try {
    const { enabled, intervalMinutes } = req.body || {};
    if (
      typeof enabled !== "boolean" ||
      !Number.isInteger(intervalMinutes) ||
      intervalMinutes < 5 ||
      intervalMinutes > 10080
    )
      return res
        .status(400)
        .json({ message: "Choose an interval between 5 minutes and 7 days." });
    await pool.execute(
      "UPDATE mssql_sync_schedule SET enabled=?, interval_minutes=?, next_run_at=IF(?=1, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL) WHERE id=1",
      [enabled, intervalMinutes, enabled, intervalMinutes],
    );
    return getMssqlSyncSchedule(req, res, next);
  } catch (error) {
    next(error);
  }
}

// A database advisory lock prevents multiple server processes from running
// the same scheduled import. The next run is claimed before work begins.
export async function runDueMssqlSync(
  executor = pool,
  runImport = importMssqlStudents,
) {
  const lock = await executor.getConnection();
  let acquired = false;
  try {
    const [[result]] = await lock.query("SELECT GET_LOCK(?, 0) AS acquired", [
      LOCK_NAME,
    ]);
    acquired = Number(result.acquired) === 1;
    if (!acquired) return false;
    await lock.beginTransaction();
    let claimed, activityId;
    try {
      // Holding the advisory lock proves no previous run is still executing.
      await lock.query(
        "UPDATE mssql_sync_activity SET status='interrupted', finished_at=NOW(), message='The server stopped before this run finished.' WHERE status='running'",
      );
      await lock.query(
        "UPDATE mssql_sync_schedule SET last_finished_at=NOW(), last_status='interrupted', last_message='The server stopped before this run finished.' WHERE id=1 AND last_status='running'",
      );
      [claimed] = await lock.query(
        "UPDATE mssql_sync_schedule SET last_started_at=NOW(), last_finished_at=NULL, last_status='running', last_message=NULL, next_run_at=DATE_ADD(NOW(), INTERVAL interval_minutes MINUTE) WHERE id=1 AND enabled=1 AND next_run_at<=NOW()",
      );
      if (claimed.affectedRows) {
        const [created] = await lock.query(
          "INSERT INTO mssql_sync_activity (started_at, status) VALUES (NOW(), 'running')",
        );
        activityId = created.insertId;
      }
      await lock.commit();
    } catch (error) {
      await lock.rollback();
      throw error;
    }
    if (!claimed.affectedRows) return false;
    let statusCode = 200;
    let body;
    let failure;
    let status, message;
    try {
      await runImport(
        { scheduledImport: true, body: { updateExistingBirthdays: false } },
        {
          status(code) {
            statusCode = code;
            return this;
          },
          json(value) {
            body = value;
            return this;
          },
        },
        (error) => {
          failure = error;
        },
      );
      if (failure) throw failure;
      if (statusCode >= 400)
        throw Object.assign(
          new Error(body?.message || "Scheduled synchronization failed."),
          { status: statusCode },
        );
      status = "success";
      message = `${body?.message || "Synchronization completed."}${body?.invalid ? ` ${body.invalid} invalid row(s) skipped; review a manual preview for details.` : ""}`;
    } catch (error) {
      console.error("Scheduled SQL Server sync failed:", error.message);
      status = "failed";
      message =
        (error.status && error.status < 500) ||
        /^(Configure MSSQL_|Unable to sign in to SQL Server\.|Unable to reach the configured SQL Server\.)/.test(
          error.message,
        )
          ? error.message
          : "Synchronization failed. Check server logs and the SQL Server connection.";
    }
    message = String(message).slice(0, 1000);
    await lock.beginTransaction();
    try {
      await lock.query(
        "UPDATE mssql_sync_schedule SET last_finished_at=NOW(), last_status=?, last_message=? WHERE id=1",
        [status, message],
      );
      const periodLabel = body?.period
        ? `${body.period.schoolYear} · ${body.period.term || `Semester ${body.period.semester}`}`.slice(
            0,
            100,
          )
        : null;
      await lock.query(
        "UPDATE mssql_sync_activity SET finished_at=NOW(), status=?, period_label=?, created_count=?, updated_count=?, unchanged_count=?, deactivated_count=?, invalid_count=?, message=? WHERE id=?",
        [
          status,
          periodLabel,
          body?.inserted ?? null,
          body?.updated ?? null,
          body?.unchanged ?? null,
          body?.deactivated ?? null,
          body?.invalid ?? null,
          message,
          activityId,
        ],
      );
      await lock.commit();
    } catch (error) {
      await lock.rollback();
      throw error;
    }
    return true;
  } finally {
    try {
      if (acquired) await lock.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    } finally {
      lock.release();
    }
  }
}

export function startMssqlSyncScheduler() {
  const tick = () =>
    runDueMssqlSync().catch((error) =>
      console.error("SQL Server scheduler failed:", error.message),
    );
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return timer;
}
