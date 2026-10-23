import { pool } from "../config/db.js";

const activityStates = ["IDLE", "ENTERING_DETAILS", "VIEWING_CREDENTIALS"];

export function kioskActivityReport(value) {
  // Older kiosk clients still report connectivity, without claiming to be idle.
  if (value === undefined) return { state: null, interactionOffsetUs: null };
  if (
    !value ||
    !activityStates.includes(value.state) ||
    (value.state !== "IDLE" &&
      (!Number.isFinite(value.idleMs) || value.idleMs < 0))
  ) {
    throw Object.assign(new Error("Invalid kiosk activity report."), { status: 400 });
  }
  if (value.state === "IDLE" || value.idleMs >= 30_000)
    return { state: "IDLE", interactionOffsetUs: null };
  return {
    state: value.state,
    interactionOffsetUs: -Math.floor(value.idleMs) * 1000,
  };
}

export function withKioskUsage(row) {
  const { activity_is_fresh, has_recent_interaction, ...kiosk } = row;
  kiosk.usage_status = !row.is_online
    ? "OFFLINE"
    : !activity_is_fresh || !activityStates.includes(row.activity_state)
      ? "UNKNOWN"
      : row.activity_state !== "IDLE" && has_recent_interaction
        ? "IN_USE"
        : "IDLE";
  return kiosk;
}

export async function ensureKioskActivitySchema(executor = pool) {
  const [rows] = await executor.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kiosks' AND COLUMN_NAME IN ('activity_state', 'activity_reported_at', 'last_interaction_at')",
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  for (const [name, type] of [
    ["activity_state", "VARCHAR(24)"],
    ["activity_reported_at", "DATETIME"],
    ["last_interaction_at", "DATETIME"],
  ]) {
    if (existing.has(name)) continue;
    try {
      await executor.query(`ALTER TABLE kiosks ADD COLUMN ${name} ${type} NULL`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}
