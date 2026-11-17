import { pool } from "../config/db.js";
import { importMssqlStudents } from "../controllers/mssql-student-import.controller.js";

// Stored schedule timestamps use Asia/Shanghai wall time, independent of server timezone.
const scheduleClockSql =
  "DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR), '%Y-%m-%d %H:%i:%s')";
const MINUTE = 60000;
const DAY = 1440 * MINUTE;
const WEEK_ANCHOR = Date.UTC(1970, 0, 5, 7, 30); // Monday, 07:30 local wall time.

export function fixedSyncSchedule(localNow, intervalMinutes) {
  const now = Date.parse(localNow.replace(" ", "T") + "Z");
  if (
    !Number.isFinite(now) ||
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 5 ||
    intervalMinutes > 10080
  )
    throw new Error("Invalid SQL synchronization schedule.");
  const minute = Math.floor(now / MINUTE) * MINUTE;
  const today = Math.floor(minute / DAY) * DAY;
  const format = (value) =>
    new Date(value).toISOString().slice(0, 19).replace("T", " ");
  let due = false;
  for (let day = today; day <= today + 15 * DAY; day += DAY) {
    if (new Date(day).getUTCDay() === 0) continue; // No Sunday imports.
    const opening = day + 450 * MINUTE;
    const closing = day + 1020 * MINUTE;
    // Short intervals restart at opening. Daily/weekly intervals use a fixed calendar anchor.
    const first =
      intervalMinutes < 1440
        ? opening
        : WEEK_ANCHOR +
          Math.ceil((opening - WEEK_ANCHOR) / (intervalMinutes * MINUTE)) *
            intervalMinutes *
            MINUTE;
    for (let slot = first; slot <= closing; slot += intervalMinutes * MINUTE) {
      if (slot === minute) due = true;
      if (slot > minute) return { due, nextRunAt: format(slot) };
    }
  }
  throw new Error("No synchronization slot found.");
}

const LOCK_NAME = "dispenser_mssql_scheduled_sync";

export async function ensureMssqlSyncScheduleSchema(executor = pool) {
  await executor.query(`CREATE TABLE IF NOT EXISTS mssql_sync_schedule (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    deactivate_missing_students BOOLEAN NOT NULL DEFAULT TRUE,
    interval_minutes INT UNSIGNED NOT NULL DEFAULT 1440,
    next_run_at DATETIME NULL,
    last_started_at DATETIME NULL,
    last_finished_at DATETIME NULL,
    last_status VARCHAR(16) NULL,
    last_message VARCHAR(1000) NULL
  )`);
  const [columns] = await executor.query(
    "SHOW COLUMNS FROM mssql_sync_schedule LIKE 'deactivate_missing_students'",
  );
  if (!columns.length) {
    try {
      await executor.query(
        "ALTER TABLE mssql_sync_schedule ADD COLUMN deactivate_missing_students BOOLEAN NOT NULL DEFAULT TRUE",
      );
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
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
    res.set("Cache-Control", "no-store").json({
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
      "SELECT enabled, deactivate_missing_students, interval_minutes, DATE_FORMAT(next_run_at, '%Y-%m-%dT%H:%i:%s+08:00') AS next_run_at, last_started_at, last_finished_at, last_status, last_message FROM mssql_sync_schedule WHERE id=1",
    );
    res.json({
      ...row,
      enabled: Boolean(row.enabled),
      deactivate_missing_students: Boolean(row.deactivate_missing_students),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateMssqlSyncSchedule(req, res, next) {
  try {
    const { enabled, intervalMinutes, deactivateMissingStudents } =
      req.body || {};
    if (typeof deactivateMissingStudents !== "boolean")
      return res.status(400).json({
        message:
          "Choose whether to deactivate students missing from the SQL Server list.",
      });
    if (
      typeof enabled !== "boolean" ||
      !Number.isInteger(intervalMinutes) ||
      intervalMinutes < 5 ||
      intervalMinutes > 10080
    )
      return res
        .status(400)
        .json({ message: "Choose an interval between 5 minutes and 7 days." });
    const [[clock]] = await pool.query(
      `SELECT ${scheduleClockSql} AS local_now`,
    );
    const nextRunAt = enabled
      ? fixedSyncSchedule(clock.local_now, intervalMinutes).nextRunAt
      : null;
    await pool.execute(
      "UPDATE mssql_sync_schedule SET enabled=?, interval_minutes=?, deactivate_missing_students=?, next_run_at=? WHERE id=1",
      [enabled, intervalMinutes, deactivateMissingStudents, nextRunAt],
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
    let claimed, activityId, deactivateMissingStudents;
    try {
      // Holding the advisory lock proves no previous run is still executing.
      await lock.query(
        "UPDATE mssql_sync_activity SET status='interrupted', finished_at=NOW(), message='The server stopped before this run finished.' WHERE status='running'",
      );
      await lock.query(
        "UPDATE mssql_sync_schedule SET last_finished_at=NOW(), last_status='interrupted', last_message='The server stopped before this run finished.' WHERE id=1 AND last_status='running'",
      );
      const [[settings]] = await lock.query(
        `SELECT enabled, interval_minutes, deactivate_missing_students, DATE_FORMAT(next_run_at, '%Y-%m-%d %H:%i:%s') AS scheduled_at, ${scheduleClockSql} AS local_now FROM mssql_sync_schedule WHERE id=1 FOR UPDATE`,
      );
      claimed = { affectedRows: 0 };
      if (settings.enabled) {
        const slot = fixedSyncSchedule(
          settings.local_now,
          Number(settings.interval_minutes),
        );
        const due =
          slot.due &&
          (!settings.scheduled_at ||
            settings.scheduled_at <= settings.local_now);
        if (due) {
          [claimed] = await lock.query(
            "UPDATE mssql_sync_schedule SET last_started_at=NOW(), last_finished_at=NULL, last_status='running', last_message=NULL, next_run_at=? WHERE id=1 AND enabled=1",
            [slot.nextRunAt],
          );
        } else if (settings.scheduled_at !== slot.nextRunAt) {
          await lock.query(
            "UPDATE mssql_sync_schedule SET next_run_at=? WHERE id=1",
            [slot.nextRunAt],
          );
        }
      }
      if (claimed.affectedRows) {
        deactivateMissingStudents = Boolean(
          settings.deactivate_missing_students,
        );
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
        {
          scheduledImport: true,
          body: { updateExistingBirthdays: false, deactivateMissingStudents },
        },
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
