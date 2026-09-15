import crypto from "node:crypto";
import { config } from "../config/env.js";
const key = () => Buffer.from(config().encryptionKey, "hex");
export function encryptPassword(value) {
  if (key().length !== 32)
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be 64 hexadecimal characters",
    );
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  return {
    encrypted_password: Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]).toString("base64"),
    password_iv: iv.toString("base64"),
    password_auth_tag: cipher.getAuthTag().toString("base64"),
  };
}
export function decryptPassword(row) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(row.password_iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(row.password_auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.encrypted_password, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
