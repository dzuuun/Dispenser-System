import { pool } from "../config/db.js";

const [[column]] = await pool.query(
  "SHOW COLUMNS FROM wifi_vouchers LIKE 'is_active'",
);
if (!column)
  await pool.query(
    "ALTER TABLE wifi_vouchers ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER voucher_code",
  );

const [indexes] = await pool.query(
  "SHOW INDEX FROM wifi_vouchers WHERE Key_name='available_voucher'",
);
if (indexes.length)
  await pool.query("ALTER TABLE wifi_vouchers DROP INDEX available_voucher");
await pool.query(
  "ALTER TABLE wifi_vouchers ADD INDEX available_voucher (is_active, is_assigned)",
);

console.log("Voucher status schema applied.");
await pool.end();
