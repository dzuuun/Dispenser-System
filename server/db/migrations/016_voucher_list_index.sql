ALTER TABLE wifi_vouchers
  ADD INDEX voucher_period_list (academic_period_id, voucher_code, id);
