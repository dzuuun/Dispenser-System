import bcrypt from "bcrypt";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import { sessionCookieOptions } from "../services/session-cookie.service.js";
const refreshCookie = "ndmu_credentials_refresh";
const hashToken = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const secretsMatch = (left, right) => {
  const leftValue = Buffer.from(String(left || ""));
  const rightValue = Buffer.from(String(right || ""));
  return (
    leftValue.length === rightValue.length &&
    crypto.timingSafeEqual(leftValue, rightValue)
  );
};
const getCookie = (req, name) =>
  String(req.headers.cookie || "")
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
const setRefreshCookie = (req, res, token) =>
  res.cookie(refreshCookie, token,
    sessionCookieOptions(req, "/dispenser/api/auth", 7 * 24 * 60 * 60 * 1000));
const clearRefreshCookie = (req, res) =>
  res.clearCookie(refreshCookie, sessionCookieOptions(req, "/dispenser/api/auth"));
const issue = async (admin, req, res) => {
  const sessionId = crypto.randomUUID();
  const refreshToken = jwt.sign(
    { sub: admin.id, jti: sessionId },
    config().refreshSecret,
    {
      expiresIn: "7d",
    },
  );
  await pool.execute(
    "INSERT INTO admin_refresh_sessions (id, admin_user_id, token_hash, expires_at, ip_address, user_agent) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?, ?)",
    [
      sessionId,
      admin.id,
      hashToken(refreshToken),
      req.ip,
      req.header("user-agent")?.slice(0, 255) || null,
    ],
  );
  setRefreshCookie(req, res, refreshToken);
  return {
    accessToken: jwt.sign(
      { sub: admin.id, username: admin.username, role: admin.role_name },
      config().accessSecret,
      { expiresIn: "15m" },
    ),
  };
};
export async function login(req, res) {
  const username = String(req.body.email || req.body.username || "")
    .trim()
    .toLowerCase();
  const { password } = req.body;
  const [rows] = await pool.execute(
    "SELECT a.*, r.name role_name FROM admin_users a JOIN roles r ON r.id=a.role_id WHERE a.username=? AND a.is_active=1",
    [username],
  );
  if (
    !rows[0] ||
    !(await bcrypt.compare(password || "", rows[0].password_hash))
  )
    return res.status(401).json({ message: "Invalid username or password." });
  await pool.execute("UPDATE admin_users SET last_login=NOW() WHERE id=?", [
    rows[0].id,
  ]);
  res.json({
    admin: {
      id: rows[0].id,
      username: rows[0].username,
      fullName: rows[0].full_name,
      role: rows[0].role_name,
    },
    ...(await issue(rows[0], req, res)),
  });
}
export async function me(req, res) {
  res.json({ admin: req.admin });
}
export async function refresh(req, res) {
  const refreshToken = getCookie(req, refreshCookie);
  if (!refreshToken) return res.status(204).end();
  try {
    const payload = jwt.verify(refreshToken, config().refreshSecret);
    const [rows] = await pool.execute(
      "SELECT a.*, r.name role_name FROM admin_users a JOIN roles r ON r.id=a.role_id WHERE a.id=? AND a.is_active=1",
      [payload.sub],
    );
    const [[session]] = await pool.execute(
      "SELECT id FROM admin_refresh_sessions WHERE id=? AND admin_user_id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>NOW()",
      [payload.jti, payload.sub, hashToken(refreshToken)],
    );
    if (!rows[0] || !session)
      return res.status(401).json({ message: "Session is no longer active." });
    await pool.execute(
      "UPDATE admin_refresh_sessions SET revoked_at=NOW(), last_used_at=NOW() WHERE id=?",
      [session.id],
    );
    res.json(await issue(rows[0], req, res));
  } catch {
    clearRefreshCookie(req, res);
    res.status(401).json({ message: "Please sign in again." });
  }
}
export async function logout(req, res) {
  const refreshToken = getCookie(req, refreshCookie);
  try {
    const payload = jwt.verify(refreshToken, config().refreshSecret);
    await pool.execute(
      "UPDATE admin_refresh_sessions SET revoked_at=NOW() WHERE id=? AND admin_user_id=?",
      [payload.jti, payload.sub],
    );
  } catch {}
  clearRefreshCookie(req, res);
  res.status(204).end();
}
export async function setupStatus(_req, res) {
  const [[row]] = await pool.query("SELECT COUNT(*) total FROM admin_users");
  res.json({ required: Number(row.total) === 0 });
}
export async function setup(req, res) {
  const firstName = String(req.body.firstName || "").trim(),
    middleName = String(req.body.middleName || "").trim(),
    lastName = String(req.body.lastName || "").trim(),
    email = String(req.body.email || "")
      .trim()
      .toLowerCase(),
    password = String(req.body.password || "");
  const setupSecret = String(req.body.setupSecret || "");
  const expectedSetupSecret = config().initialSetupSecret;
  if (expectedSetupSecret && !secretsMatch(setupSecret, expectedSetupSecret))
    return res.status(401).json({ message: "Invalid setup code." });
  if (!firstName || !lastName || !email || password.length < 12)
    return res.status(400).json({
      message:
        "Complete all required fields and use a password with at least 12 characters.",
    });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ message: "Enter a valid email address." });
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query(
      "SELECT GET_LOCK('ndmu_credentials_initial_admin', 5) acquired",
    );
    if (!lock.acquired)
      return res
        .status(503)
        .json({ message: "Setup is currently busy. Please try again." });
    const [[count]] = await connection.query(
      "SELECT COUNT(*) total FROM admin_users",
    );
    if (Number(count.total))
      return res.status(403).json({ message: "Initial setup is complete." });
    await connection.execute(
      "INSERT IGNORE INTO roles (name, description) VALUES (?, ?)",
      ["Super Admin", "Full system access"],
    );
    const [[role]] = await connection.execute(
      "SELECT id, name FROM roles WHERE name=?",
      ["Super Admin"],
    );
    const fullName = [firstName, middleName, lastName]
      .filter(Boolean)
      .join(" ");
    const hash = await bcrypt.hash(password, 12);
    const [created] = await connection.execute(
      "INSERT INTO admin_users (username, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, 1)",
      [email, hash, fullName, role.id],
    );
    const admin = {
      id: created.insertId,
      username: email,
      full_name: fullName,
      role_name: role.name,
    };
    res.status(201).json({
      admin: { id: admin.id, email, fullName, role: role.name },
      ...(await issue(admin, req, res)),
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ message: "That username is already in use." });
    throw error;
  } finally {
    try {
      await connection.query(
        "SELECT RELEASE_LOCK('ndmu_credentials_initial_admin')",
      );
    } catch {}
    connection.release();
  }
}
