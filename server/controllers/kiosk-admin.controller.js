import { pool } from "../config/db.js";
import { kioskActivityReport, withKioskUsage } from "../services/kiosk-activity.service.js";

const ONLINE_WINDOW_MINUTES = 5;
const browserName = (userAgent = "") => {
  if (/edg/i.test(userAgent)) return "Microsoft Edge";
  if (/firefox/i.test(userAgent)) return "Firefox";
  if (/chrome|chromium/i.test(userAgent)) return "Chromium";
  if (/safari/i.test(userAgent)) return "Safari";
  return "Browser";
};
const observedIp = (req) =>
  String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim() ||
  req.socket.remoteAddress?.replace(/^::ffff:/, "") ||
  null;
const validId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const kioskFields = `id, kiosk_code, kiosk_name, location, is_active, last_seen,
  ip_address, hostname, uptime_seconds, browser_status, current_page,
  mac_address, operating_system, created_at, updated_at,
  activity_state, activity_reported_at, last_interaction_at,
  (activity_reported_at >= DATE_SUB(NOW(), INTERVAL 20 SECOND)) activity_is_fresh,
  (last_interaction_at > DATE_SUB(NOW(), INTERVAL 30 SECOND)) has_recent_interaction,
  (is_active=1 AND last_seen >= DATE_SUB(NOW(), INTERVAL ${ONLINE_WINDOW_MINUTES} MINUTE)) is_online`;

export async function listKiosks(_req, res) {
  const [rows] = await pool.query(
    `SELECT ${kioskFields}
       FROM kiosks
      WHERE is_active=1
      ORDER BY is_online DESC, last_seen DESC, kiosk_name ASC`,
  );
  res.set("Cache-Control", "no-store").json(rows.map(withKioskUsage));
}

export async function getKiosk(req, res) {
  if (!validId(req.params.id))
    return res.status(400).json({ message: "Invalid kiosk." });
  const [[kiosk]] = await pool.execute(
    `SELECT ${kioskFields} FROM kiosks WHERE id=? AND is_active=1`,
    [req.params.id],
  );
  if (!kiosk) return res.status(404).json({ message: "Kiosk not found." });
  const [commands] = await pool.execute(
    `SELECT id, command, channel, status, result_text, created_at, dispatched_at, completed_at
       FROM kiosk_commands WHERE kiosk_id=? ORDER BY id DESC LIMIT 8`,
    [req.params.id],
  );
  res.set("Cache-Control", "no-store").json({ kiosk: withKioskUsage(kiosk), commands });
}

const actions = {
  reload: { command: "RELOAD", label: "Reload dispenser" },
  restartBrowser: { command: "RESTART_BROWSER", label: "Restart browser" },
  reboot: { command: "REBOOT", label: "Reboot device" },
  shutdown: { command: "SHUTDOWN", label: "Shut down device" },
};

export async function queueKioskAction(req, res) {
  if (!validId(req.params.id))
    return res.status(400).json({ message: "Invalid kiosk." });
  const action = actions[String(req.body?.action || "")];
  if (!action)
    return res.status(400).json({ message: "Select a valid kiosk action." });
  const [[kiosk]] = await pool.execute(
    "SELECT id FROM kiosks WHERE id=? AND is_active=1",
    [req.params.id],
  );
  if (!kiosk) return res.status(404).json({ message: "Kiosk not found." });
  const [result] = await pool.execute(
    "INSERT INTO kiosk_commands (kiosk_id, command, channel) VALUES (?, ?, 'BROWSER')",
    [kiosk.id, action.command],
  );
  res.status(202).json({
    id: result.insertId,
    message: `${action.label} queued for the kiosk.`,
  });
}

export async function kioskHeartbeat(req, res) {
  const activity = kioskActivityReport(req.body?.activity);
  const uptime = Number(req.body?.uptimeSeconds);
  const page =
    String(req.body?.currentPage || "")
      .trim()
      .slice(0, 500) || null;
  const hostname =
    String(req.body?.hostname || "")
      .trim()
      .slice(0, 255) || null;
  const operatingSystem =
    String(req.body?.operatingSystem || "")
      .trim()
      .slice(0, 160) || null;
  const name =
    String(req.body?.name || "")
      .trim()
      .slice(0, 120) || null;
  const location =
    String(req.body?.location || "")
      .trim()
      .slice(0, 160) || null;
  const userAgent = req.get("user-agent") || "";
  await pool.execute(
    `UPDATE kiosks SET last_seen=NOW(), ip_address=?, hostname=COALESCE(?, hostname),
       uptime_seconds=?, browser_status=?, current_page=?, operating_system=?,
       kiosk_name=COALESCE(?, kiosk_name), location=COALESCE(?, location),
       activity_state=?, activity_reported_at=NOW(),
       last_interaction_at=TIMESTAMPADD(MICROSECOND, ?, NOW()) WHERE id=?`,
    [
      observedIp(req),
      hostname,
      Number.isFinite(uptime) ? Math.max(0, Math.floor(uptime)) : null,
      browserName(userAgent),
      page,
      operatingSystem,
      name,
      location,
      activity.state,
      activity.interactionOffsetUs,
      req.kioskId,
    ],
  );
  const [commands] = await pool.execute(
    "SELECT id, command FROM kiosk_commands WHERE kiosk_id=? AND channel='BROWSER' AND status='QUEUED' ORDER BY id LIMIT 10",
    [req.kioskId],
  );
  if (commands.length)
    await pool.query(
      `UPDATE kiosk_commands SET status='DISPATCHED', dispatched_at=NOW() WHERE id IN (${commands.map(() => "?").join(",")})`,
      commands.map((command) => command.id),
    );
  res.set("Cache-Control", "no-store").json({ commands });
}

export async function completeKioskCommand(req, res) {
  const commandId = Number(req.body?.commandId);
  const status = String(req.body?.status || "").toUpperCase();
  if (
    !Number.isInteger(commandId) ||
    !["COMPLETED", "FAILED", "UNSUPPORTED"].includes(status)
  )
    return res.status(400).json({ message: "Invalid command result." });
  const [result] = await pool.execute(
    `UPDATE kiosk_commands SET status=?, result_text=?, completed_at=NOW()
       WHERE id=? AND kiosk_id=? AND status='DISPATCHED'`,
    [
      status,
      String(req.body?.result || "").slice(0, 1000) || null,
      commandId,
      req.kioskId,
    ],
  );
  if (!result.affectedRows)
    return res.status(404).json({ message: "Command not found." });
  res.status(204).end();
}
