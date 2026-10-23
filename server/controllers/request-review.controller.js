import { pool } from "../config/db.js";
import {
  REVIEW_LEASE_SECONDS,
  pendingReviewRequest,
  readRequestReview,
  requireRequestReview,
  reviewIdentity,
} from "../services/request-review.service.js";

async function updateReview(req, res, renew) {
  const { id, token } = reviewIdentity(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await pendingReviewRequest(connection, id, req.admin);
    if (renew) {
      await requireRequestReview(connection, req);
    } else {
      const review = await readRequestReview(connection, id);
      if (
        review?.is_live &&
        (Number(review.admin_user_id) !== Number(req.admin.sub) || review.review_token !== token)
      ) {
        throw Object.assign(
          new Error(`This request is already being reviewed by ${review.reviewer_name || "another administrator"}.`),
          { status: 409 },
        );
      }
    }
    await connection.execute(
      `INSERT INTO credential_request_reviews (request_id, admin_user_id, review_token, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ${REVIEW_LEASE_SECONDS} SECOND))
       ON DUPLICATE KEY UPDATE admin_user_id=VALUES(admin_user_id),
         review_token=VALUES(review_token), expires_at=VALUES(expires_at)`,
      [id, req.admin.sub, token],
    );
    await connection.commit();
    res.set("Cache-Control", "no-store").json({
      leaseMs: REVIEW_LEASE_SECONDS * 1000,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export const acquireRequestReview = (req, res) => updateReview(req, res, false);
export const renewRequestReview = (req, res) => updateReview(req, res, true);

export async function releaseRequestReview(req, res) {
  const { id, token } = reviewIdentity(req);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "SELECT id FROM password_reset_requests WHERE id=? FOR UPDATE",
      [id],
    );
    // A delayed cleanup from another tab must never release a newer review.
    await connection.execute(
      "DELETE FROM credential_request_reviews WHERE request_id=? AND admin_user_id=? AND review_token=?",
      [id, req.admin.sub, token],
    );
    await connection.commit();
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
