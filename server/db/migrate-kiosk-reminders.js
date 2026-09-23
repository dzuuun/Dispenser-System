import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const [[existing]] = await pool.query("SHOW TABLES LIKE 'kiosk_reminders'");
if (!existing) {
  const sql = await fs.readFile(
    path.join(here, "migrations/004_kiosk_reminders.sql"),
    "utf8",
  );
  for (const statement of sql
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await pool.query(statement);
}
console.log("Kiosk reminders schema applied.");
await pool.end();
