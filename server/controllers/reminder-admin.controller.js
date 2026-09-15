import { z } from "zod";
import { pool } from "../config/db.js";

const reminderSchema = z.object({
  placement: z.enum(["BANNER", "GUIDELINE", "TIP"]),
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().max(500).optional().default(""),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export async function listReminders(_req, res) {
  const [rows] = await pool.query(
    "SELECT id, placement, title, message, sort_order, is_active, updated_at FROM kiosk_reminders ORDER BY sort_order, id",
  );
  res.json(rows);
}

export async function createReminder(req, res) {
  const parsed = reminderSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: "Complete all required reminder fields." });
  const value = parsed.data;
  const [result] = await pool.execute(
    "INSERT INTO kiosk_reminders (placement, title, message, sort_order, is_active) VALUES (?, ?, ?, ?, ?)",
    [value.placement, value.title, value.message || null, value.sortOrder, value.isActive],
  );
  res.status(201).json({ id: result.insertId, message: "Kiosk reminder created." });
}

export async function updateReminder(req, res) {
  const id = Number(req.params.id);
  const parsed = reminderSchema.safeParse(req.body);
  if (!Number.isInteger(id) || id < 1 || !parsed.success)
    return res.status(400).json({ message: "Enter valid reminder details." });
  const value = parsed.data;
  const [result] = await pool.execute(
    "UPDATE kiosk_reminders SET placement=?, title=?, message=?, sort_order=?, is_active=? WHERE id=?",
    [value.placement, value.title, value.message || null, value.sortOrder, value.isActive, id],
  );
  if (!result.affectedRows)
    return res.status(404).json({ message: "Reminder not found." });
  res.json({ message: "Kiosk reminder updated." });
}
