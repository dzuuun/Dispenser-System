import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(
  path.join(here, "migrations/003_password_reset_requests.sql"),
  "utf8",
);

for (const statement of sql
  .split(";")
  .map((value) => value.trim())
  .filter(Boolean)) {
  await pool.query(statement);
}

console.log("Password reset request schema applied.");
await pool.end();
