const characters =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".replace(
    /[iIl1Oo0]/g,
    "",
  );
const limit = Math.floor(256 / characters.length) * characters.length;

export function generateRandomPassword() {
  let password;
  do {
    password = "";
    while (password.length < 12) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      for (const byte of bytes) {
        // Reject the incomplete range so each allowed character is equally likely.
        if (byte >= limit) continue;
        password += characters[byte % characters.length];
        if (password.length === 12) break;
      }
    }
  } while (!/[A-Za-z]/.test(password) || !/[2-9]/.test(password));
  return password;
}
