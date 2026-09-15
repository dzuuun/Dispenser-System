# NDMU Student Credentials Dispenser

MVP for a secure, self-service student credentials kiosk with a React frontend and Express/MySQL API.

## Run locally

1. Copy `.env.example` to `.env`, fill in database and secrets. Generate a 32-byte AES key with `openssl rand -hex 32`.
2. During development, run `npm run rebuild-db -w server`. This applies the single canonical schema file at `server/db/rebuild-development.sql` and deliberately removes all development data. The command refuses to run unless `NODE_ENV=development`; the configured MySQL user needs `CREATE` and `DROP` permission.
3. Run `npm install`, then `npm run serve`.
4. Open `http://localhost:3000`. The API health check is at `http://localhost:3000/api/health`.

The deployed application uses one port only: Express serves both the React site and `/api` endpoints on browser-safe port `3000`. For development, `npm run dev` builds the client once, then runs the API with file watching on that same port.

## First administrator

After applying the schema, set a strong `SEED_ADMIN_PASSWORD` (at least 12 characters) in `.env`, then run `npm run seed-admin -w server`. Sign in at `http://localhost:3000/admin`. The script never overwrites an existing administrator.

## Canonical schema

The development rebuild creates only the active application model: users and roles, courses, students, credential accounts, WiFi vouchers, kiosks, requests, reminders, controls, transactions, and audit logs. It intentionally excludes retired course hierarchy, shared-credential, academic-period, and legacy-settings tables.

The rebuilt database contains no administrator until you complete the setup screen or run the seed command. Never use demo defaults in production.

## Security notes

- Credentials are AES-256-GCM encrypted at rest; admin passwords use bcrypt.
- Admin refresh tokens are HttpOnly, SameSite cookies that are rotated and revoked server-side; access tokens exist only in memory.
- Kiosk browsers receive an HttpOnly device session from the configured kiosk code. Do not expose `KIOSK_SECRET` through a `VITE_` client variable; it is reserved for a native device agent.
- Super Admin is required for credential reveals, credential-request processing, imports, voucher releases, kiosk commands, module controls, and administrator management. These mutations are written to the audit log.
- Temporary kiosk sessions expire in three minutes and can be explicitly invalidated.
- Production startup rejects missing or placeholder secrets. Configure HTTPS, restrictive CORS, backups, and a reverse proxy before deployment.
