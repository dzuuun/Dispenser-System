export function credentialSummaryState(credential) {
  const missingPassword = Object.hasOwn(credential, "password")
    ? !String(credential.password ?? "").trim()
    : credential.hasPassword === false;

  return {
    unavailable: Boolean(credential.unavailable || missingPassword),
    // A linked account without a password still needs a reset, not creation.
    requestKind: credential.unavailable ? "ACCOUNT_CREATION" : "PASSWORD_RESET",
  };
}
