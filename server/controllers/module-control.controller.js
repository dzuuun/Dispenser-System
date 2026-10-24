import { pool } from "../config/db.js";
import {
  ACCOUNT_REQUEST_MODULES,
  PASSWORD_RESET_MODULES,
} from "../../shared/credential-request-controls.mjs";

const MODULES = new Set([
  "VOUCHER",
  "SATP",
  "SCHOOLOGY",
  "KUMOSOFT",
  "EMAIL",
  "KIOSK",
]);

export async function listModuleControls(_req, res) {
  const [rows] = await pool.query(
    "SELECT module_key, is_visible, is_maintenance, accept_password_resets, accept_account_requests, updated_at FROM credential_module_controls WHERE module_key<>'PASSWORD_RESET_REQUEST' ORDER BY FIELD(module_key, 'VOUCHER','SATP','SCHOOLOGY','KUMOSOFT','EMAIL','KIOSK')",
  );
  res.set("Cache-Control", "no-store").json(rows);
}

export async function updateModuleControl(req, res) {
  const moduleKey = String(req.params.module || "").toUpperCase();
  if (!MODULES.has(moduleKey))
    return res.status(404).json({ message: "Credential module not found." });
  const isVisible = req.body?.isVisible;
  const isMaintenance = req.body?.isMaintenance;
  const acceptPasswordResets = req.body?.acceptPasswordResets;
  const acceptAccountRequests = req.body?.acceptAccountRequests;
  const settings = {
    isVisible,
    isMaintenance,
    acceptPasswordResets,
    acceptAccountRequests,
  };
  if (
    Object.values(settings).some(
      (value) => value !== undefined && typeof value !== "boolean",
    )
  )
    return res
      .status(400)
      .json({ message: "Control settings must be true or false." });
  if (
    acceptPasswordResets !== undefined &&
    !PASSWORD_RESET_MODULES.includes(moduleKey)
  )
    return res.status(400).json({
      message: "Password reset requests are not supported for this module.",
    });
  if (
    acceptAccountRequests !== undefined &&
    !ACCOUNT_REQUEST_MODULES.includes(moduleKey)
  )
    return res.status(400).json({
      message: "New-account requests are not supported for this module.",
    });
  if (moduleKey === "KIOSK" && typeof isVisible === "boolean")
    return res
      .status(400)
      .json({ message: "Use maintenance mode to control the kiosk." });
  if (Object.values(settings).every((value) => value === undefined))
    return res.status(400).json({
      message: "Choose a visibility, maintenance, or request setting.",
    });
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
  if (typeof acceptPasswordResets === "boolean") {
    assignments.push("accept_password_resets=?");
    values.push(acceptPasswordResets);
  }
  if (typeof acceptAccountRequests === "boolean") {
    assignments.push("accept_account_requests=?");
    values.push(acceptAccountRequests);
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
    "SELECT module_key, is_visible, is_maintenance, accept_password_resets, accept_account_requests FROM credential_module_controls WHERE module_key<>'PASSWORD_RESET_REQUEST'",
  );
  res.set("Cache-Control", "no-store").json(rows);
}
