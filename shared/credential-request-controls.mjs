export const ACCOUNT_REQUEST_MODULES = ["EMAIL", "KUMOSOFT", "SCHOOLOGY"];
export const PASSWORD_RESET_MODULES = ["EMAIL", "KUMOSOFT", "SCHOOLOGY"];
export const DEFAULT_VOUCHER_PAUSED_MESSAGE =
  "WiFi vouchers are currently exhausted. Voucher requests will reopen next semester.";
export const voucherPausedMessage = (control = {}) =>
  String(control?.voucher_paused_message || "").trim() ||
  DEFAULT_VOUCHER_PAUSED_MESSAGE;

const enabled = (value, fallback) =>
  value == null ? fallback : value === true || value === 1;

export const voucherRequestsEnabled = (control = {}) =>
  enabled(control.accept_voucher_requests, true);

export function credentialRequestOptions(type, control = {}) {
  return {
    passwordResets:
      PASSWORD_RESET_MODULES.includes(type) &&
      enabled(control.accept_password_resets, true),
    accountRequests:
      ACCOUNT_REQUEST_MODULES.includes(type) &&
      enabled(control.accept_account_requests, true),
  };
}
