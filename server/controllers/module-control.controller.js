import { pool } from "../config/db.js";

const MODULES = new Set([
  "VOUCHER",
  "SATP",
  "SCHOOLOGY",
  "KUMOSOFT",
  "EMAIL",
  "KIOSK",
  "PASSWORD_RESET_REQUEST",
]);

export async function listModuleControls(_req, res) {
  const [rows] = await pool.query(
    "SELECT module_key, is_visible, is_maintenance, updated_at FROM credential_module_controls ORDER BY FIELD(module_key, 'VOUCHER','SATP','SCHOOLOGY','KUMOSOFT','EMAIL','PASSWORD_RESET_REQUEST','KIOSK')",
  );
  res.set("Cache-Control", "no-store").json(rows);
}

export async function updateModuleControl(req, res) {
  const moduleKey = String(req.params.module || "").toUpperCase();
  if (!MODULES.has(moduleKey))
    return res.status(404).json({ message: "Credential module not found." });
  const isVisible = req.body?.isVisible;
  const isMaintenance = req.body?.isMaintenance;
  if (moduleKey === "KIOSK" && typeof isVisible === "boolean")
    return res
      .status(400)
      .json({ message: "Use maintenance mode to control the kiosk." });
  if (
    moduleKey === "PASSWORD_RESET_REQUEST" &&
    typeof isMaintenance === "boolean"
  )
    return res
      .status(400)
      .json({ message: "Use visibility to control password reset requests." });
  if (typeof isVisible !== "boolean" && typeof isMaintenance !== "boolean")
    return res
      .status(400)
      .json({ message: "Choose a visibility or maintenance setting." });
  const [[currentControl]] = await pool.execute(
    "SELECT is_maintenance FROM credential_module_controls WHERE module_key=?",
    [moduleKey],
  );
  if (!currentControl)
    return res.status(404).json({ message: "Credential module not found." });
  const assignments = [],
    values = [];
  if (typeof isVisible === "boolean") {
    assignments.push("is_visible=?");
    values.push(isVisible);
  }
  if (typeof isMaintenance === "boolean") {
    assignments.push("is_maintenance=?");
    values.push(isMaintenance);
  }
  values.push(moduleKey);
  await pool.execute(
    `UPDATE credential_module_controls SET ${assignments.join(", ")} WHERE module_key=?`,
    values,
  );
  const maintenanceLifted =
    moduleKey === "KIOSK" &&
    currentControl.is_maintenance === 1 &&
    isMaintenance === false;
  if (maintenanceLifted) {
    const [queuedReloads] = await pool.execute(
      "INSERT INTO kiosk_commands (kiosk_id, command, channel) SELECT id, 'RELOAD', 'BROWSER' FROM kiosks WHERE is_active=1",
    );
    return res.json({
      message: `${moduleKey} control updated. Reload queued for ${queuedReloads.affectedRows} active kiosk${queuedReloads.affectedRows === 1 ? "" : "s"}.`,
    });
  }
  res.json({ message: `${moduleKey} control updated.` });
}

export async function publicModuleControls(_req, res) {
  const [rows] = await pool.query(
    "SELECT module_key, is_visible, is_maintenance FROM credential_module_controls",
  );
  res.set("Cache-Control", "no-store").json(rows);
}
