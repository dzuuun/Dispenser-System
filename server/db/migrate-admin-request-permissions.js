import { pool } from "../config/db.js";
import { ensureAdminRequestPermissionsSchema } from "../services/admin-request-permissions.service.js";

try {
  await ensureAdminRequestPermissionsSchema();
  console.log("Administrator request permissions are ready.");
} finally {
  await pool.end();
}
