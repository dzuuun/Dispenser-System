import { pool } from "../config/db.js";

const [indexes] = await pool.query("SHOW INDEX FROM wifi_vouchers WHERE Key_name='voucher_period_list'");
if (!indexes.length)
  await pool.query("ALTER TABLE wifi_vouchers ADD INDEX voucher_period_list (academic_period_id, voucher_code, id)");
console.log("Voucher list index applied.");
await pool.end();
