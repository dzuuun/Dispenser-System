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
    const [claimed] = await lock.query(
      "UPDATE mssql_sync_schedule SET last_started_at=NOW(), last_finished_at=NULL, last_status='running', last_message=NULL, next_run_at=DATE_ADD(NOW(), INTERVAL interval_minutes MINUTE) WHERE id=1 AND enabled=1 AND next_run_at<=NOW()",
    );
    if (!claimed.affectedRows) return false;
    let statusCode = 200;
    let body;
    let failure;
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
        throw new Error(body?.message || "Scheduled synchronization failed.");
      const message = `${body?.message || "Synchronization completed."}${body?.invalid ? ` ${body.invalid} invalid row(s) skipped; review a manual preview for details.` : ""}`;
      await lock.query(
        "UPDATE mssql_sync_schedule SET last_finished_at=NOW(), last_status='success', last_message=? WHERE id=1",
        [message.slice(0, 1000)],
      );
    } catch (error) {
      console.error("Scheduled SQL Server sync failed:", error.message);
      const message =
        error.status && error.status < 500
          ? error.message
          : "Synchronization failed. Check server logs and the SQL Server connection.";
      await lock.query(
        "UPDATE mssql_sync_schedule SET last_finished_at=NOW(), last_status='failed', last_message=? WHERE id=1",
        [String(message).slice(0, 1000)],
      );
    }
    return true;
  } finally {
    if (acquired) await lock.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    lock.release();
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
