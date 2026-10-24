import { pool } from "../config/db.js";
import { ensureCredentialRequestControlsSchema } from "../services/credential-request-controls.service.js";

try {
  await ensureCredentialRequestControlsSchema();
  console.log("Credential request controls schema applied.");
} finally {
  await pool.end();
}
