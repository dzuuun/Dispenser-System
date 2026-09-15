import "dotenv/config";

const required = [
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "CREDENTIAL_ENCRYPTION_KEY",
];
export function config() {
  const missing = required.filter((key) => !process.env[key]);
  const production = process.env.NODE_ENV === "production";
  const unsafe = required.filter((key) =>
    /^(change_me|replace_with_|development-|0{64}$)/i.test(process.env[key] || ""),
  );
  if (missing.length && production)
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  if (unsafe.length && production)
    throw new Error(`Unsafe production environment values: ${unsafe.join(", ")}`);
  return {
    port: Number(process.env.PORT || 3000),
    db: {
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME || "ndmu_credentials",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
    },
    accessSecret:
      process.env.JWT_ACCESS_SECRET || "development-access-secret-only",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || "development-refresh-secret-only",
    encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || "0".repeat(64),
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
    kioskCode: process.env.KIOSK_CODE || "KIOSK-MIS-01",
    kioskSecret: process.env.KIOSK_SECRET || "development-kiosk-secret",
  };
}
