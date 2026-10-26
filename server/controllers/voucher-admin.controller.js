import { pool } from "../config/db.js";
import {
  importPreview,
  importErrorPreview,
} from "../services/import-preview.service.js";
import {
  tableSearch,
  dateSearchFields,
} from "../services/table-search.service.js";
import {
  readWorkbookRows,
  workbookBase64,
  workbookBuffer,
} from "../services/workbook.service.js";
import {
  currentAcademicPeriod,
  requireCurrentAcademicPeriod,
} from "../services/academic-period.service.js";

const safeExportValue = (value) => {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const buildErrorReport = async (source, errors) => {
  if (!errors.length) return null;
  const messages = new Map(errors.map((error) => [error.row, error.message]));
  return workbookBase64(
    source
      .map((item) => ({
        VoucherCode: safeExportValue(item.code),
        Error: messages.get(item.row),
      }))
      .filter((item) => item.Error),
    "Import errors",
  );
};

export async function listVouchers(req, res) {
  const period = await currentAcademicPeriod();
  const periodId = period?.id || 0;
  if (req.query.summary === "1") {
    const [[summary]] = await pool.execute(
      `SELECT COUNT(*) AS total,
        SUM(is_active=1 AND is_assigned=0 AND is_released=0) AS available,
        SUM(is_active=1 AND is_assigned=1) AS assigned
       FROM wifi_vouchers WHERE academic_period_id=?`,
      [periodId],
    );
    return res.json(summary);
  }
  if (req.query.draw !== undefined) {
    const draw = Math.max(0, Math.trunc(Number(req.query.draw) || 0));
    const start = Math.max(0, Math.trunc(Number(req.query.start) || 0));
    const length = Math.min(
      100,
      Math.max(10, Math.trunc(Number(req.query.length) || 25)),
    );
    const search = tableSearch(req.query["search[value]"] ?? req.query.search, [
      "w.voucher_code",
      "s.student_id",
      "CONCAT_WS(' ', NULLIF(s.first_name, ''), NULLIF(NULLIF(TRIM(s.middle_name), '-'), ''), NULLIF(s.last_name, ''))",
      "CASE WHEN s.student_id IS NULL THEN 'Not assigned' ELSE '' END",
      "CASE WHEN w.is_active=0 THEN 'Inactive' WHEN w.is_assigned=1 THEN 'Assigned' WHEN w.is_released=1 THEN 'Released' ELSE 'Available' END",
      ...dateSearchFields("w.assigned_at"),
    ]);
    const where = ["w.academic_period_id=?"];
    const values = [periodId];
    const status = String(req.query.status || "all");
    const filterStatus = status === "active" || status === "inactive";
    if (filterStatus) {
      where.push("w.is_active=?");
      values.push(status === "active" ? 1 : 0);
    }
    if (search.sql) {
      where.push(search.sql);
      values.push(...search.values);
    }
    const sortColumns = {
      code: "w.voucher_code",
      student: "s.last_name",
      status: "w.is_assigned",
      assigned: "w.assigned_at",
    };
    const sortColumn = sortColumns[req.query.sort] || sortColumns.code;
    const direction = req.query.direction === "desc" ? "DESC" : "ASC";
    const summaryQuery = pool.execute(
      `SELECT COUNT(*) AS total,
        COALESCE(SUM(is_active=1 AND is_assigned=0 AND is_released=0), 0) AS available,
        COALESCE(SUM(is_active=1 AND is_assigned=1), 0) AS assigned
       FROM wifi_vouchers WHERE academic_period_id=?`,
      [periodId],
    );
    // Only join students when the search includes student fields.
    const countQuery =
      search.term || filterStatus
        ? pool.execute(
            `SELECT COUNT(*) AS count FROM wifi_vouchers w${search.term ? " LEFT JOIN students s ON s.voucher_id=w.id" : ""} WHERE ${where.join(" AND ")}`,
            values,
          )
        : Promise.resolve(null);
    const rowsQuery = pool.query(
      `SELECT w.id, w.voucher_code, w.is_active, w.is_assigned, w.is_released, w.assigned_at, w.released_at, w.created_at,
        s.id student_record_id, s.student_id, s.first_name, s.middle_name, s.last_name
       FROM wifi_vouchers w LEFT JOIN students s ON s.voucher_id=w.id
       WHERE ${where.join(" AND ")} ORDER BY ${sortColumn} ${direction}, w.id ${direction} LIMIT ? OFFSET ?`,
      [...values, length, start],
    );
    const [summaryResult, countResult, [rows]] = await Promise.all([
      summaryQuery,
      countQuery,
      rowsQuery,
    ]);
    const [[summary]] = summaryResult;
    const filtered = countResult ? countResult[0][0].count : summary.total;
    return res.json({
      draw,
      recordsTotal: summary.total,
      recordsFiltered: filtered,
      summary,
      data: rows,
    });
  }
  const [rows] = await pool.execute(
    `SELECT w.id, w.voucher_code, w.is_active, w.is_assigned, w.is_released, w.assigned_at, w.released_at, w.created_at,
      s.id student_record_id, s.student_id, s.first_name, s.middle_name, s.last_name
     FROM wifi_vouchers w
     LEFT JOIN students s ON s.voucher_id = w.id
     WHERE w.academic_period_id=?
     ORDER BY w.created_at DESC, w.id DESC`,
    [periodId],
  );
  res.json(rows);
}

export async function downloadVoucherTemplate(_req, res) {
  const file = await workbookBuffer(
    [{ VoucherCode: "WIFI-EXAMPLE-001" }],
    "Vouchers",
  );
  res
    .status(200)
    .set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="wifi-voucher-import-template.xlsx"',
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
    rows = await readWorkbookRows(file.buffer, file.originalname);
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
    code: String(
      row.VoucherCode || row.voucher_code || row.Code || row.code || "",
    )
      .trim()
      .toUpperCase(),
  }));
}

async function reviewVoucherImport(file) {
  const source = await readVoucherRows(file);
  const [existingRows] = await pool.query(
    "SELECT voucher_code FROM wifi_vouchers",
  );
  const existing = new Set(
    existingRows.map((row) => String(row.voucher_code).trim().toUpperCase()),
  );
  const seen = new Set();
  const valid = [],
    validRows = [],
    errors = [],
    duplicates = [],
    unchanged = [];
  for (const item of source) {
    if (!item.code) {
      errors.push({ row: item.row, message: "VoucherCode is required." });
    } else if (seen.has(item.code)) {
      duplicates.push({ row: item.row, code: item.code });
    } else {
      seen.add(item.code);
      if (existing.has(item.code)) unchanged.push(item);
      else {
        valid.push(item.code);
        validRows.push(item);
      }
    }
  }
  return {
    valid,
    validRows,
    errors,
    duplicates,
    unchanged,
    total: source.length,
  };
}

export async function validateVoucherImport(req, res) {
  const review = await reviewVoucherImport(req.file);
  const preview = importPreview(
    {
      new: review.validRows.map((item) => ({
        row: item.row,
        label: item.code,
        message: "Voucher will be added.",
      })),
      duplicate: review.duplicates.map((item) => ({
        row: item.row,
        label: item.code,
        message: "Existing or duplicate voucher will be skipped.",
      })),
      unchanged: review.unchanged.map((item) => ({
        row: item.row,
        label: item.code,
        message:
          "Voucher already exists. Its status and assignment will be kept.",
      })),
      error: importErrorPreview(review.errors),
    },
    req.query,
  );
  if (preview.category) return res.json(preview);
  res.json({
    ...preview,
    new: review.valid.length,
    total: review.total,
    update: 0,
    unchanged: review.unchanged.length,
    invalid: review.errors.length,
    duplicates: review.duplicates.length,
    errors: review.errors,
    duplicateRows: review.duplicates.slice(0, 20),
    errorReport: await buildErrorReport(
      await readVoucherRows(req.file),
      review.errors,
    ),
  });
}

export async function importVouchers(req, res) {
  const review = await reviewVoucherImport(req.file);
  if (review.valid.length) {
    const period = await requireCurrentAcademicPeriod();
    await pool.query(
      "INSERT INTO wifi_vouchers (voucher_code, academic_period_id) VALUES " +
        review.valid.map(() => "(?, ?)").join(", "),
      review.valid.flatMap((code) => [code, period.id]),
    );
  }
  res.status(201).json({
    added: review.valid.length,
    total: review.total,
    updated: 0,
    unchanged: review.unchanged.length,
    duplicates: review.duplicates.length,
    invalid: review.errors.length,
    errors: review.errors,
    errorReport: await buildErrorReport(
      await readVoucherRows(req.file),
      review.errors,
    ),
  });
}

export async function releaseVoucher(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1)
    return res.status(400).json({ message: "Invalid voucher." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const period = await requireCurrentAcademicPeriod(connection);
    // Match the student-first lock order used when assigning/replacing vouchers.
    const [students] = await connection.execute(
      "SELECT id FROM students WHERE voucher_id=? AND academic_period_id=? ORDER BY id FOR UPDATE",
      [id, period.id],
    );
    const [[voucher]] = await connection.execute(
      "SELECT id, is_assigned, is_released FROM wifi_vouchers WHERE id=? AND academic_period_id=? FOR UPDATE",
      [id, period.id],
    );
    if (!voucher) {
      await connection.rollback();
      return res.status(404).json({ message: "Voucher not found." });
    }
    let available = [];
    if (students.length) {
      [available] = await connection.query(
        `SELECT w.id, w.voucher_code FROM wifi_vouchers w
         WHERE w.academic_period_id=? AND w.id<>?
           AND w.is_active=1 AND w.is_assigned=0 AND w.is_released=0
           AND NOT EXISTS (SELECT 1 FROM students s WHERE s.voucher_id=w.id)
         ORDER BY w.id LIMIT ? FOR UPDATE`,
        [period.id, id, students.length],
      );
      if (available.length < students.length) {
        await connection.rollback();
        return res.status(409).json({
          message:
            "Not enough available WiFi vouchers to assign replacements. Add voucher stock before releasing this voucher. The current assignment was kept.",
        });
      }
    }
    await connection.execute(
      "UPDATE wifi_vouchers SET is_active=IF(?, 0, is_active), is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
      [students.length > 0 || voucher.is_assigned ? 1 : 0, id],
    );
    const replacements = [];
    for (const [index, student] of students.entries()) {
      const replacement = available[index];
      await connection.execute(
        "UPDATE wifi_vouchers SET is_assigned=1, is_released=0, assigned_at=NOW(), released_at=NULL WHERE id=?",
        [replacement.id],
      );
      await connection.execute("UPDATE students SET voucher_id=? WHERE id=?", [
        replacement.id,
        student.id,
      ]);
      replacements.push({
        studentId: student.id,
        voucherCode: replacement.voucher_code,
      });
    }
    await connection.commit();
    res.json({
      id,
      reassigned: replacements.length,
      replacements,
      message: replacements.length
        ? `Voucher released. ${replacements.length === 1 ? "A replacement voucher was assigned to the student" : `Replacement vouchers were assigned to ${replacements.length} students`}.`
        : voucher.is_released
          ? "Voucher was already released."
          : "Voucher permanently released from active stock.",
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function previewVoucherRelease(req, res) {
  const period = await requireCurrentAcademicPeriod();
  const quantity = Number(req.query.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000)
    return res
      .status(400)
      .json({ message: "Choose a quantity between 1 and 1,000 vouchers." });
  const [vouchers] = await pool.query(
    `SELECT id, voucher_code
       FROM wifi_vouchers
      WHERE academic_period_id=? AND is_active=1 AND is_assigned=0 AND is_released=0
      ORDER BY id
      LIMIT ?`,
    [period.id, quantity],
  );
  res.json({
    vouchers,
    message:
      vouchers.length < quantity
        ? `Only ${vouchers.length} available voucher${vouchers.length === 1 ? "" : "s"} can be released.`
        : "Vouchers ready for review.",
  });
}

export async function releaseVoucherBatch(req, res) {
  const ids = [
    ...new Set(
      Array.isArray(req.body?.voucherIds)
        ? req.body.voucherIds.map(Number)
        : [],
    ),
  ]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 1000);
  if (!ids.length)
    return res
      .status(400)
      .json({ message: "Choose at least one available voucher." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const period = await requireCurrentAcademicPeriod(connection);
    const [vouchers] = await connection.query(
      `SELECT id, voucher_code FROM wifi_vouchers
        WHERE id IN (${ids.map(() => "?").join(",")})
          AND academic_period_id=? AND is_active=1 AND is_assigned=0 AND is_released=0
        ORDER BY id FOR UPDATE`,
      [...ids, period.id],
    );
    if (vouchers.length !== ids.length) {
      await connection.rollback();
      return res.status(409).json({
        message:
          "One or more selected vouchers are no longer available. Generate the list again.",
      });
    }
    await connection.query(
      `UPDATE wifi_vouchers SET is_released=1, released_at=NOW()
        WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    await connection.commit();
    res.json({
      vouchers,
      message: `${vouchers.length} voucher${vouchers.length === 1 ? "" : "s"} released permanently.`,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// At the start of a new semester, remove the complete previous voucher set.
// Student links (and optional assignment-history rows) must be removed first so
// the operation remains valid for both current and legacy database schemas.
export async function clearSemesterVouchers(_req, res) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const period = await requireCurrentAcademicPeriod(connection);
    const [[{ voucherCount }]] = await connection.query(
      "SELECT COUNT(*) AS voucherCount FROM wifi_vouchers WHERE academic_period_id=? FOR UPDATE",
      [period.id],
    );
    if (!voucherCount) {
      await connection.rollback();
      return res.json({
        cleared: 0,
        message: "There are no vouchers to delete.",
      });
    }
    const [students] = await connection.query(
      "UPDATE students SET voucher_id=NULL WHERE academic_period_id=? AND voucher_id IS NOT NULL",
      [period.id],
    );
    const [[historyTable]] = await connection.query(
      `SELECT COUNT(*) AS existsFlag
       FROM information_schema.tables
       WHERE table_schema=DATABASE() AND table_name='voucher_assignment_history'`,
    );
    if (historyTable.existsFlag) {
      await connection.query(
        `DELETE h FROM voucher_assignment_history h
         JOIN wifi_vouchers w ON w.id=h.voucher_id
         WHERE w.academic_period_id=?`,
        [period.id],
      );
    }
    await connection.execute(
      "DELETE FROM wifi_vouchers WHERE academic_period_id=?",
      [period.id],
    );
    await connection.commit();
    res.json({
      cleared: Number(voucherCount),
      unassigned: students.affectedRows,
      message: `${voucherCount} voucher${voucherCount === 1 ? "" : "s"} permanently deleted for the new semester.`,
    });
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
    const period = await requireCurrentAcademicPeriod(connection);
    const [[voucher]] = await connection.execute(
      "SELECT is_assigned FROM wifi_vouchers WHERE id=? AND academic_period_id=? FOR UPDATE",
      [id, period.id],
    );
    if (!voucher) {
      await connection.rollback();
      return res.status(404).json({ message: "Voucher not found." });
    }
    if (!isActive) {
      await connection.execute(
        "UPDATE students SET voucher_id=NULL WHERE voucher_id=? AND academic_period_id=?",
        [id, period.id],
      );
      await connection.execute(
        "UPDATE wifi_vouchers SET is_active=0, is_assigned=0, is_released=1, released_at=NOW() WHERE id=?",
        [id],
      );
    } else {
      await connection.execute(
        "UPDATE wifi_vouchers SET is_active=1 WHERE id=?",
        [id],
      );
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
