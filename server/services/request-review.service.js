import { pool } from "../config/db.js";
import { canHandleRequest } from "../../shared/request-permissions.mjs";

export const REVIEW_LEASE_SECONDS = 90;
export const requestReviewSchema = `CREATE TABLE IF NOT EXISTS credential_request_reviews (
  request_id BIGINT UNSIGNED PRIMARY KEY,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  review_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (request_id) REFERENCES password_reset_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
)`;

export async function ensureRequestReviewSchema(executor = pool) {
  await executor.query(requestReviewSchema);
}

export function reviewIdentity(req) {
  const id = Number(req.params.id);
  const token = req.body?.reviewToken;
  if (!Number.isSafeInteger(id) || id < 1)
    throw Object.assign(new Error("Invalid credential request."), { status: 400 });
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw Object.assign(
      new Error("Open Review request to start a review session."),
      { status: 409 },
    );
  return { id, token };
}

export async function pendingReviewRequest(connection, id, admin) {
  // The existing request row serializes every review operation and resolution.
  const [[request]] = await connection.execute(
    "SELECT student_id, credential_type, request_kind FROM password_reset_requests WHERE id=? AND status='PENDING' FOR UPDATE",
    [id],
  );
  if (!request)
    throw Object.assign(new Error("Pending credential request not found."), {
      status: 404,
    });
  if (!canHandleRequest(admin, request))
    throw Object.assign(
      new Error("You do not have permission to handle this request."),
      { status: 403 },
    );
  return request;
}

export async function readRequestReview(connection, id) {
  const [[review]] = await connection.execute(
    `SELECT r.admin_user_id, r.review_token, (r.expires_at > NOW()) AS is_live,
      a.full_name AS reviewer_name
     FROM credential_request_reviews r JOIN admin_users a ON a.id=r.admin_user_id
     WHERE r.request_id=?`,
    [id],
  );
  return review || null;
}

export async function requireRequestReview(connection, req) {
  const { id, token } = reviewIdentity(req);
  const review = await readRequestReview(connection, id);
  if (
    !review?.is_live ||
    Number(review.admin_user_id) !== Number(req.admin.sub) ||
    review.review_token !== token
  )
    throw Object.assign(
      new Error("This review session has ended or is owned by another administrator. Close the dialog and review the request again."),
      { status: 409 },
    );
}

export async function clearRequestReview(connection, id) {
  await connection.execute(
    "DELETE FROM credential_request_reviews WHERE request_id=?",
    [id],
  );
}
