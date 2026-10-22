import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { pool } from "../config/db.js";
import { effectiveRequestPermissions } from "../../shared/request-permissions.mjs";
export async function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  let claims;
  try {
    claims = jwt.verify(token, config().accessSecret);
  } catch {
    return res.status(401).json({ message: "Authentication required." });
  }
  try {
    // Read current access on every call so changes also apply to existing sessions.
    const [[admin]] = await pool.execute(
      `SELECT a.id, a.username, a.full_name, a.is_active, a.request_permissions, r.name role_name
       FROM admin_users a JOIN roles r ON r.id=a.role_id WHERE a.id=?`,
      [claims.sub],
    );
    if (!admin?.is_active)
      return res.status(401).json({ message: "Authentication required." });
    req.admin = {
      ...claims,
      sub: admin.id,
      username: admin.username,
      fullName: admin.full_name,
      role: admin.role_name,
      requestPermissions: effectiveRequestPermissions(
        admin.request_permissions,
        admin.role_name,
      ),
    };
    next();
  } catch (error) {
    next(error);
  }
}

export const requireRoles =
  (...roles) =>
  (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role))
      return res
        .status(403)
        .json({ message: `${roles.join(" or ")} access is required.` });
    next();
  };
