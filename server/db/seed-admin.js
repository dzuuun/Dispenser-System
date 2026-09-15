import bcrypt from "bcrypt";
import { pool } from "../config/db.js";

const username = process.env.SEED_ADMIN_USERNAME || "admin";
const password = process.env.SEED_ADMIN_PASSWORD;
const fullName = process.env.SEED_ADMIN_NAME || "NDMU Super Administrator";
if (!password || password.length < 12)
  throw new Error(
    "Set SEED_ADMIN_PASSWORD to a strong password of at least 12 characters before running this command.",
  );

await pool.execute(
  "INSERT IGNORE INTO roles (name, description) VALUES (?, ?)",
  ["Super Admin", "Full system access"],
);
const [[role]] = await pool.execute("SELECT id FROM roles WHERE name=?", [
  "Super Admin",
]);
const hash = await bcrypt.hash(password, 12);
const [result] = await pool.execute(
  "INSERT IGNORE INTO admin_users (username, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, 1)",
  [username, hash, fullName, role.id],
);
await pool.end();
console.log(
  result.affectedRows
    ? `Created administrator '${username}'.`
    : `Administrator '${username}' already exists; no changes made.`,
);
