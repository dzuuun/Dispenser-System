import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const statements = (
  await fs.readFile(
    path.join(here, "migrations/002_separate_account_tables.sql"),
    "utf8",
  )
)
  .split(";")
  .map((sql) => sql.trim())
  .filter(Boolean);
// The first four statements create the separate account tables. The remaining
// INSERTs are only needed on databases created with the former shared table.
for (const sql of statements.slice(0, 4)) await pool.query(sql);
const [[legacy]] = await pool.query(
  "SELECT COUNT(*) total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='student_credentials'",
);
if (Number(legacy.total))
  for (const sql of statements.slice(4)) await pool.query(sql);
await pool.end();
console.log(
  "Separate account tables are ready. Existing shared credential records were copied when present.",
);
