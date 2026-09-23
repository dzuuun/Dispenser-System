import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// npm workspace commands run the API with `server/` as the working directory,
// while deployment configuration lives at the repository root.
dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../.env",
  ),
});

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
  const production = process.env.NODE_ENV === "production";
  const productionRequired = [...required, "INITIAL_SETUP_SECRET"];
  const missing = (production ? productionRequired : required).filter(
    (key) => !process.env[key],
  );
  const unsafe = (production ? productionRequired : required).filter((key) =>
    /^(change_me|replace_with_|development-|0{64}$)/i.test(
      process.env[key] || "",
    ),
  );
  if (missing.length && production)
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  if (unsafe.length && production)
    throw new Error(
      `Unsafe production environment values: ${unsafe.join(", ")}`,
    );
  return {
    port: Number(process.env.PORT || 3000),
    // Bind to every network interface by default so kiosks and administrators
    // on the LAN can use http://<server-ip>:<port>/dispenser/.
    listenHost: process.env.LISTEN_HOST || "0.0.0.0",
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
    initialSetupSecret: process.env.INITIAL_SETUP_SECRET || "",
    mssql: {
      server: process.env.MSSQL_SERVER || "",
      port: Number(process.env.MSSQL_PORT || 1433),
      database: process.env.MSSQL_DATABASE || "",
      user: process.env.MSSQL_USER || "",
      password: process.env.MSSQL_PASSWORD || "",
      view:
        process.env.MSSQL_STUDENT_VIEW || "dbo.vw_CredentialsDispenserStudents",
      encrypt: process.env.MSSQL_ENCRYPT !== "false",
      trustServerCertificate:
        process.env.MSSQL_TRUST_SERVER_CERTIFICATE === "true",
    },
  };
}
