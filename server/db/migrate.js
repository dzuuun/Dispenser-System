import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(
  path.join(here, "migrations/001_initial.sql"),
  "utf8",
);
for (const statement of sql
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean))
  await pool.query(statement);
console.log("Initial schema applied.");
await pool.end();
