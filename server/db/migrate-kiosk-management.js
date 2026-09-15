import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../config/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(path.join(here, "migrations/006_kiosk_management.sql"), "utf8");

try {
  for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) {
    try {
      await pool.query(statement);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
  console.log("Kiosk management schema applied.");
} finally {
  await pool.end();
}
