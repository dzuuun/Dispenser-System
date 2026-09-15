import mysql from "mysql2/promise";
import { config } from "../config/env.js";

const cfg = config();
// Database identifiers cannot be parameterized; restrict this value to safe MySQL identifiers.
if (!/^[A-Za-z0-9_]+$/.test(cfg.db.database))
  throw new Error(
    "DB_NAME may contain only letters, numbers, and underscores.",
  );

const connection = await mysql.createConnection({
  host: cfg.db.host,
  port: cfg.db.port,
  user: cfg.db.user,
  password: cfg.db.password,
});
await connection.query(
  `CREATE DATABASE IF NOT EXISTS \`${cfg.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
);
await connection.end();
console.log(`Database '${cfg.db.database}' is ready.`);
