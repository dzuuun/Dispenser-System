import assert from "node:assert/strict";
import { pool } from "../server/config/db.js";

// Use a temporary table so verification never changes application records.
const connection = await pool.getConnection();
try {
  const [[clock]] = await connection.query(
    "SELECT @@session.time_zone AS zone, NOW() AS current_time_value",
  );
  assert.equal(clock.zone, "+08:00");
  assert.ok(Math.abs(clock.current_time_value.getTime() - Date.now()) < 5000);
  await connection.query(
    "CREATE TEMPORARY TABLE timezone_check (event_time TIMESTAMP, local_time DATETIME, birthday DATE)",
  );
  await connection.query(
    "INSERT INTO timezone_check VALUES ('2026-10-22 08:49:05', '2026-10-22 08:49:05', '2005-01-31')",
  );
  const [[row]] = await connection.query("SELECT * FROM timezone_check");
  assert.equal(row.event_time.toISOString(), "2026-10-22T00:49:05.000Z");
  assert.equal(row.local_time.toISOString(), row.event_time.toISOString());
  assert.equal(row.birthday, "2005-01-31");
  const [[roundTrip]] = await connection.query(
    "SELECT CAST(? AS DATETIME) AS value",
    [new Date("2026-10-22T00:49:05.000Z")],
  );
  assert.equal(roundTrip.value.toISOString(), row.event_time.toISOString());
  console.log(
    "Passed: database clock, TIMESTAMP, DATETIME, birthdays, Date write round-trip.",
  );
} finally {
  await connection.query("DROP TEMPORARY TABLE IF EXISTS timezone_check");
  connection.release();
  await pool.end();
}
