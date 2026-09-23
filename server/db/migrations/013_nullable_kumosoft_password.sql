-- Kumosoft imports may contain an account ID before its password is provided.
ALTER TABLE kumosoft_accounts
  MODIFY encrypted_password TEXT NULL,
  MODIFY password_iv VARCHAR(50) NULL,
  MODIFY password_auth_tag VARCHAR(50) NULL;

ALTER TABLE pending_account_imports
  MODIFY encrypted_password TEXT NULL,
  MODIFY password_iv VARCHAR(50) NULL,
  MODIFY password_auth_tag VARCHAR(50) NULL;
