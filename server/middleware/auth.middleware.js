import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
export function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  try {
    req.admin = jwt.verify(token, config().accessSecret);
    next();
  } catch {
    res.status(401).json({ message: "Authentication required." });
  }
}

export const requireRoles = (...roles) => (req, res, next) => {
  if (!req.admin || !roles.includes(req.admin.role))
    return res.status(403).json({ message: `${roles.join(" or ")} access is required.` });
  next();
};
