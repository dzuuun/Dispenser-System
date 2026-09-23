import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { config } from "../config/env.js";

const cfg = config();
if (
  process.env.NODE_ENV !== "development" ||
  process.env.ALLOW_DB_REBUILD !== "true"
)
  throw new Error(
    "Database rebuild is allowed only with NODE_ENV=development and ALLOW_DB_REBUILD=true.",
  );
if (cfg.db.database !== "ndmu_credentials")
  throw new Error(
    "The canonical development SQL targets only the ndmu_credentials database.",
  );

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(
  path.join(here, "rebuild-development.sql"),
  "utf8",
);
const connection = await mysql.createConnection({
  host: cfg.db.host,
  port: cfg.db.port,
  user: cfg.db.user,
  password: cfg.db.password,
  multipleStatements: true,
});

try {
  await connection.query(sql);
  console.log("Development database rebuilt from rebuild-development.sql.");
} finally {
  await connection.end();
}
