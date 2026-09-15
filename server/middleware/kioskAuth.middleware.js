import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { pool } from "../config/db.js";

const cookie = (req, name) => String(req.headers.cookie || "").split(";")
  .map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
const observedIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
  || req.socket.remoteAddress?.replace(/^::ffff:/, "") || "";

export async function createKioskSession(req, res, next) {
  const cfg = config();
  const code = String(req.header("x-kiosk-code") || "").trim();
  if (!code || code !== cfg.kioskCode)
    return res.status(401).json({ message: "This device is not enrolled as a kiosk." });
  try {
    let [[kiosk]] = await pool.execute("SELECT id, kiosk_code, is_active FROM kiosks WHERE kiosk_code=?", [code]);
    if (!kiosk && code === cfg.kioskCode) {
      const generatedSecret = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
      await pool.execute(
        "INSERT INTO kiosks (kiosk_code, kiosk_name, location, secret_hash, is_active, last_seen, ip_address) VALUES (?, ?, ?, ?, 1, NOW(), ?)",
        [code, "Credentials kiosk", "Unassigned", generatedSecret, observedIp(req)],
      );
      [[kiosk]] = await pool.execute("SELECT id, kiosk_code, is_active FROM kiosks WHERE kiosk_code=?", [code]);
    }
    if (!kiosk?.is_active) return res.status(401).json({ message: "This kiosk is inactive or not enrolled." });
    const token = jwt.sign({ scope: "kiosk-device", kioskId: kiosk.id, kioskCode: kiosk.kiosk_code }, cfg.accessSecret, { expiresIn: "12h" });
    res.cookie("ndmu_kiosk", token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 12 * 60 * 60 * 1000, path: "/api/kiosk" });
    res.status(204).end();
  } catch (error) { next(error); }
}

export async function requireKiosk(req, res, next) {
  const cfg = config();
  try {
    const session = jwt.verify(cookie(req, "ndmu_kiosk"), cfg.accessSecret);
    if (session.scope !== "kiosk-device") throw new Error("Invalid kiosk session");
    const [[kiosk]] = await pool.execute("SELECT id, kiosk_code FROM kiosks WHERE id=? AND is_active=1", [session.kioskId]);
    if (!kiosk) throw new Error("Inactive kiosk");
    req.kioskCode = kiosk.kiosk_code;
    req.kioskId = kiosk.id;
    return next();
  } catch {}
  const code = req.header("x-kiosk-code"), secret = req.header("x-kiosk-secret");
  if (!code || !secret) return res.status(401).json({ message: "Kiosk authentication failed." });
  try {
    const [[kiosk]] = await pool.execute(
      "SELECT id, secret_hash, is_active FROM kiosks WHERE kiosk_code=?",
      [code],
    );
    if (kiosk) {
      if (!kiosk.is_active || !(await bcrypt.compare(secret, kiosk.secret_hash)))
        return res.status(401).json({ message: "Kiosk authentication failed." });
      await pool.execute("UPDATE kiosks SET last_seen=NOW() WHERE id=?", [kiosk.id]);
      req.kioskCode = code;
      req.kioskId = kiosk.id;
      return next();
    }
    return res.status(401).json({ message: "Kiosk authentication failed." });
  } catch (error) {
    next(error);
  }
}
