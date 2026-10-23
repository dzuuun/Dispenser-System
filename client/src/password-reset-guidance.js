export const DEFAULT_PASSWORD_RESET_FOLLOW_UP =
  "After at least two business hours, sign in with the default credentials shown here.";
export const NEW_PASSWORD_RESET_FOLLOW_UP =
  "Return to this kiosk after at least two business hours to check for your new password.";

export function passwordResetGuidance(credential) {
  const hasDefaultPassword = credential.hasPassword === true || Boolean(credential.password?.trim());
  const checkForNewPassword = typeof credential.password === "string"
    ? Boolean(credential.password) && Array.from(credential.password).length < 2
    : credential.checkForNewPassword === true;
  return {
    hasDefaultPassword,
    checkForNewPassword,
    followUp: hasDefaultPassword && !checkForNewPassword
      ? DEFAULT_PASSWORD_RESET_FOLLOW_UP
      : NEW_PASSWORD_RESET_FOLLOW_UP,
  };
}
