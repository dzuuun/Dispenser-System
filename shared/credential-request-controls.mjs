export const ACCOUNT_REQUEST_MODULES = ["EMAIL", "KUMOSOFT", "SCHOOLOGY"];
export const PASSWORD_RESET_MODULES = ["EMAIL", "KUMOSOFT", "SCHOOLOGY"];

const enabled = (value, fallback) =>
  value == null ? fallback : value === true || value === 1;

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
