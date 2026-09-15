import { pool } from "../config/db.js";
import XLSX from "xlsx";

export async function listVouchers(_req, res) {
  const [rows] = await pool.query(
    `SELECT w.id, w.voucher_code, w.is_active, w.is_assigned, w.is_released, w.assigned_at, w.released_at, w.created_at,
      s.id student_record_id, s.student_id, s.first_name, s.middle_name, s.last_name
     FROM wifi_vouchers w
     LEFT JOIN students s ON s.voucher_id = w.id
     ORDER BY w.created_at DESC, w.id DESC`,
  );
  res.json(rows);
}

export function downloadVoucherTemplate(_req, res) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([{ VoucherCode: "WIFI-EXAMPLE-001" }]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Vouchers");
  const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  res
    .status(200)
    .set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="wifi-voucher-import-template.xlsx"',
    })
    .send(file);
}

async function readVoucherRows(file) {
  if (!file || !/\.xlsx$/i.test(file.originalname || "")) {
    const error = new Error("Choose an XLSX voucher file.");
    error.status = 400;
    throw error;
  }
  let rows;
  try {
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } catch {
    const error = new Error("The XLSX file could not be read.");
    error.status = 400;
    throw error;
  }
  if (!rows.length) {
    const error = new Error("The XLSX file has no voucher rows.");
    error.status = 400;
    throw error;
  }
  return rows.map((row, index) => ({
    row: index + 2,
    code: String(row.VoucherCode || row.voucher_code || row.Code || row.code || "")
      .trim()
      .toUpperCase(),
  }));
}

async function reviewVoucherImport(file) {
  const source = await readVoucherRows(file);
  const [existingRows] = await pool.query("SELECT voucher_code FROM wifi_vouchers");
  const existing = new Set(existingRows.map((row) => row.voucher_code));
  const seen = new Set();
  const valid = [], errors = [], duplicates = [];
  for (const item of source) {
    if (!item.code) {
      errors.push({ row: item.row, message: "VoucherCode is required." });
    } else if (seen.has(item.code) || existing.has(item.code)) {
      duplicates.push({ row: item.row, code: item.code });
    } else {
      seen.add(item.code);
      valid.push(item.code);
    }
  }
  return { valid, errors, duplicates };
}

export async function validateVoucherImport(req, res) {
  const review = await reviewVoucherImport(req.file);
  res.json({
    new: review.valid.length,
    duplicates: review.duplicates.length,
    errors: review.errors,
    duplicateRows: review.duplicates.slice(0, 20),
  });
}

export async function importVouchers(req, res) {
  const review = await reviewVoucherImport(req.file);
  if (review.errors.length)
    return res.status(400).json({ message: "Fix invalid voucher rows before importing.", errors: review.errors });
  if (review.valid.length)
    await pool.query(
      "INSERT INTO wifi_vouchers (voucher_code) VALUES " + review.valid.map(() => "(?)").join(", "),
      review.valid,
    );
  res.status(201).json({ added: review.valid.length, duplicates: review.duplicates.length });
}

export async function releaseVoucher(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "Invalid voucher." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[voucher]] = await connection.execute(
      "SELECT id FROM wifi_vouchers WHERE id=? FOR UPDATE",
      [id],
    );
    if (!voucher) return res.status(404).json({ message: "Voucher not found." });
    await connection.execute("UPDATE students SET voucher_id=NULL WHERE voucher_id=?", [id]);
    await connection.execute(
      "UPDATE wifi_vouchers SET is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
      [id],
    );
    await connection.commit();
    res.json({ id, message: "Voucher permanently released from active stock." });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function previewVoucherRelease(req, res) {
  const quantity = Number(req.query.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000)
    return res.status(400).json({ message: "Choose a quantity between 1 and 1,000 vouchers." });
  const [vouchers] = await pool.query(
    `SELECT id, voucher_code
       FROM wifi_vouchers
      WHERE is_active=1 AND is_assigned=0 AND is_released=0
      ORDER BY id
      LIMIT ?`,
    [quantity],
  );
  res.json({
    vouchers,
    message: vouchers.length < quantity
      ? `Only ${vouchers.length} available voucher${vouchers.length === 1 ? "" : "s"} can be released.`
      : "Vouchers ready for review.",
  });
}

export async function releaseVoucherBatch(req, res) {
  const ids = [...new Set(Array.isArray(req.body?.voucherIds) ? req.body.voucherIds.map(Number) : [])]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 1000);
  if (!ids.length) return res.status(400).json({ message: "Choose at least one available voucher." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [vouchers] = await connection.query(
      `SELECT id, voucher_code FROM wifi_vouchers
        WHERE id IN (${ids.map(() => "?").join(",")})
          AND is_active=1 AND is_assigned=0 AND is_released=0
        ORDER BY id FOR UPDATE`,
      ids,
    );
    if (vouchers.length !== ids.length) {
      await connection.rollback();
      return res.status(409).json({ message: "One or more selected vouchers are no longer available. Generate the list again." });
    }
    await connection.query(
      `UPDATE wifi_vouchers SET is_released=1, released_at=NOW()
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    await connection.commit();
    res.json({ vouchers, message: `${vouchers.length} voucher${vouchers.length === 1 ? "" : "s"} released permanently.` });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function setVoucherStatus(req, res) {
  const id = Number(req.params.id);
  const isActive = req.body?.isActive;
  if (!Number.isInteger(id) || id < 1 || typeof isActive !== "boolean")
    return res.status(400).json({ message: "Invalid voucher status request." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[voucher]] = await connection.execute(
      "SELECT is_assigned FROM wifi_vouchers WHERE id=? FOR UPDATE",
      [id],
    );
    if (!voucher) {
      await connection.rollback();
      return res.status(404).json({ message: "Voucher not found." });
    }
    if (!isActive) {
      await connection.execute("UPDATE students SET voucher_id=NULL WHERE voucher_id=?", [id]);
      await connection.execute(
        "UPDATE wifi_vouchers SET is_active=0, is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
        [id],
      );
    } else {
      await connection.execute("UPDATE wifi_vouchers SET is_active=1 WHERE id=?", [id]);
    }
    await connection.commit();
    res.json({
      id,
      isActive,
      message: `Voucher ${isActive ? "activated" : "deactivated and released"}.`,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
