import bcrypt from "bcrypt";
import { pool } from "../config/db.js";

const normalize = (body) => {
  const firstName = String(body?.firstName || "").trim();
  const middleName = String(body?.middleName || "").trim();
  const lastName = String(body?.lastName || "").trim();
  return {
    firstName,
    middleName,
    lastName,
    fullName: [firstName, middleName, lastName].filter(Boolean).join(" "),
    username: String(body?.username || "").trim().toLowerCase(),
    password: String(body?.password || ""),
    roleId: Number(body?.roleId),
    isActive: body?.isActive !== false,
  };
};

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function requireSuperAdmin(req, res) {
  if (req.admin?.role === "Super Admin") return true;
  res.status(403).json({ message: "Super Admin access is required." });
  return false;
}

export async function listAdminUsers(req, res) {
  if (!requireSuperAdmin(req, res)) return;
  const [rows] = await pool.query(
    `SELECT a.id, a.username, a.full_name, a.role_id, r.name role_name,
      a.is_active, a.last_login, a.created_at
     FROM admin_users a
     JOIN roles r ON r.id=a.role_id
     ORDER BY a.full_name, a.username`,
  );
  res.json(rows);
}

export async function listAdminRoles(req, res) {
  if (!requireSuperAdmin(req, res)) return;
  const [rows] = await pool.query(
    "SELECT id, name, description FROM roles ORDER BY name",
  );
  res.json(rows);
}

export async function createAdminUser(req, res) {
  if (!requireSuperAdmin(req, res)) return;
  const input = normalize(req.body);
  if (!input.firstName || !input.lastName || !validEmail(input.username) || input.password.length < 12)
    return res.status(400).json({
      message: "Enter a full name, valid email, and password with at least 12 characters.",
    });
  const [[role]] = await pool.execute("SELECT id FROM roles WHERE id=?", [input.roleId]);
  if (!role) return res.status(400).json({ message: "Select a valid role." });
  try {
    const hash = await bcrypt.hash(input.password, 12);
    const [created] = await pool.execute(
      "INSERT INTO admin_users (username, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, ?)",
      [input.username, hash, input.fullName, input.roleId, input.isActive],
    );
    res.status(201).json({ id: created.insertId, message: "Administrator created." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      return res.status(409).json({ message: "That email is already in use." });
    throw error;
  }
}

export async function updateAdminUser(req, res) {
  if (!requireSuperAdmin(req, res)) return;
  const id = Number(req.params.id);
  const input = normalize(req.body);
  if (!Number.isInteger(id) || id < 1 || !input.firstName || !input.lastName || !validEmail(input.username))
    return res.status(400).json({ message: "Enter a valid administrator record." });
  if (input.password && input.password.length < 12)
    return res.status(400).json({ message: "New passwords must contain at least 12 characters." });
  if (id === Number(req.admin.sub) && !input.isActive)
    return res.status(400).json({ message: "You cannot deactivate your own account." });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[current]] = await connection.execute(
      `SELECT a.id, a.is_active, r.name role_name
       FROM admin_users a JOIN roles r ON r.id=a.role_id
       WHERE a.id=? FOR UPDATE`,
      [id],
    );
    if (!current) {
      await connection.rollback();
      return res.status(404).json({ message: "Administrator not found." });
    }
    const [[role]] = await connection.execute("SELECT id, name FROM roles WHERE id=?", [input.roleId]);
    if (!role) {
      await connection.rollback();
      return res.status(400).json({ message: "Select a valid role." });
    }
    if (current.role_name === "Super Admin" && current.is_active && (!input.isActive || role.name !== "Super Admin")) {
      const [[remaining]] = await connection.execute(
        `SELECT COUNT(*) total FROM admin_users a
         JOIN roles r ON r.id=a.role_id
         WHERE r.name='Super Admin' AND a.is_active=1 AND a.id<>?`,
        [id],
      );
      if (!Number(remaining.total)) {
        await connection.rollback();
        return res.status(400).json({ message: "At least one active Super Admin is required." });
      }
    }
    const values = [input.username, input.fullName, input.roleId, input.isActive];
    let sql = "UPDATE admin_users SET username=?, full_name=?, role_id=?, is_active=?";
    if (input.password) {
      sql += ", password_hash=?";
      values.push(await bcrypt.hash(input.password, 12));
    }
    sql += " WHERE id=?";
    values.push(id);
    await connection.execute(sql, values);
    await connection.commit();
    res.json({ id, message: "Administrator updated." });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY")
      return res.status(409).json({ message: "That email is already in use." });
    throw error;
  } finally {
    connection.release();
  }
}
