import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(
  path.join(here, "migrations/014_kiosk_credential_sessions.sql"),
  "utf8",
);

try {
  for (const statement of sql
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await pool.query(statement);
  console.log("Kiosk credential session schema applied.");
} finally {
  await pool.end();
}
