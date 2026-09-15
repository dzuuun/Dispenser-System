import { pool } from "../config/db.js";

const MODULES = new Set(["VOUCHER", "SATP", "SCHOOLOGY", "KUMOSOFT", "EMAIL", "KIOSK"]);

export async function listModuleControls(_req, res) {
  const [rows] = await pool.query(
    "SELECT module_key, is_visible, is_maintenance, updated_at FROM credential_module_controls ORDER BY FIELD(module_key, 'VOUCHER','SATP','SCHOOLOGY','KUMOSOFT','EMAIL','KIOSK')",
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
    return res.status(400).json({ message: "Use maintenance mode to control the kiosk." });
  if (typeof isVisible !== "boolean" && typeof isMaintenance !== "boolean")
    return res.status(400).json({ message: "Choose a visibility or maintenance setting." });
  const assignments = [], values = [];
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
  res.json({ message: `${moduleKey} control updated.` });
}

export async function publicModuleControls(_req, res) {
  const [rows] = await pool.query(
    "SELECT module_key, is_visible, is_maintenance FROM credential_module_controls",
  );
  res.set("Cache-Control", "no-store").json(rows);
}
