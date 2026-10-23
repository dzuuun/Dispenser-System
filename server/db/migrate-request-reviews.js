import { pool } from "../config/db.js";
import { ensureRequestReviewSchema } from "../services/request-review.service.js";

try {
  await ensureRequestReviewSchema();
  console.log("Credential request review locks are ready.");
} finally {
  await pool.end();
}
