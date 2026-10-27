# Credentials Dispenser

Students verify their identity at the kiosk to retrieve approved credentials and WiFi vouchers. Administrators manage student records, service accounts, vouchers, kiosks, requests, and audit activity from the web portal.

The application uses a React client, an Express API, and MySQL. Express serves
the compiled client and API beneath `/dispenser` from one application port.

## Features

- Student kiosk verification using student ID, course, last name, and birth date.
- Secure display of SATP, Schoology, Kumosoft, institutional-email, and WiFi-voucher credentials.
- Administrator portal for students, courses, vouchers, bulk imports, credential requests, kiosk monitoring, module controls, and transaction history.
- Credential controls provide separate password-reset and new-account request switches for Email, Kumosoft, and Schoology. SATP has no request switches or kiosk request buttons. Pausing requests preserves pending requests for administrators to finish; the API enforces the settings immediately, and open kiosks pick up changes during their 15-second control refresh. The two settings columns are added automatically when the API starts; upgrading an older database copies its previous password-reset setting into the individual switches once. The retired master switch is no longer displayed or enforced.
- Live kiosk usage: **In use** while someone enters details or views credentials, **Idle** after 30 seconds without interaction, and **Unknown** when recent activity reports are unavailable. The Kiosks page refreshes every three seconds. Activity reports contain only the screen state and elapsed idle time, without student details or passwords. Existing databases receive the activity columns automatically when the API starts; reload open kiosk tabs after deploying the updated client.
- XLSX validation and import for students, courses, accounts, and vouchers.
- WiFi voucher assignment, release, activation, and semester clearing.
- Super Admin audit logging for sensitive changes.
- Encrypted account passwords, hashed administrator passwords, rotating refresh sessions, and kiosk device sessions.

## Requirements

- Node.js 20 or later
- npm 10 or later
- MySQL 8.0 or later

## Quick start

1. Install dependencies.

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set real database credentials and secrets.

3. Create the development database. This deletes and recreates `ndmu_credentials`, so use it only for local development.

   ```powershell
   $env:NODE_ENV = "development"
   npm run rebuild-db -w server
   ```

4. Set a strong `SEED_ADMIN_PASSWORD` in `.env`, then create the first administrator.

   ```bash
   npm run seed-admin -w server
   ```

5. Build and run the application.

   ```bash
   npm run serve
   ```

Open [http://localhost:3000/dispenser/](http://localhost:3000/dispenser/) for
the kiosk and [http://localhost:3000/dispenser/admin](http://localhost:3000/dispenser/admin)
for the administrator portal. From another device on the same network, replace
`localhost` with this computer's LAN IP address, for example
`http://192.168.1.50:3000/dispenser/`. The health endpoint is
[http://localhost:3000/dispenser/api/health](http://localhost:3000/dispenser/api/health).

For local API development with automatic server restart, run:

```bash
npm run dev
```

The development server uses Node.js's built-in watch mode to restart after source changes.

After pulling dependency changes, use `npm ci` from the repository root to install the versions in `package-lock.json`. Run `npm audit` to check advisories. Review dependency updates individually; `npm audit fix --force` can select incompatible versions outside the declared ranges.

## Configuration

Copy `.env.example` instead of committing a real `.env` file.

| Variable                                                                       | Purpose                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                     | Use `development` locally and `production` when deployed.                                                                                                                 |
| `PORT`                                                                         | Express application port; defaults to `3000`.                                                                                                                             |
| `LISTEN_HOST`                                                                  | Network interface to listen on; defaults to `0.0.0.0` for LAN access. Set to `127.0.0.1` for reverse-proxy-only deployments.                                              |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`                      | MySQL connection settings.                                                                                                                                                |
| `JWT_ACCESS_SECRET`                                                            | Long random secret for administrator access tokens.                                                                                                                       |
| `JWT_REFRESH_SECRET`                                                           | Different long random secret for refresh sessions.                                                                                                                        |
| `CREDENTIAL_ENCRYPTION_KEY`                                                    | Exactly 64 hexadecimal characters for AES-256-GCM credential encryption.                                                                                                  |
| `KIOSK_CODE`, `KIOSK_SECRET`                                                   | Identity and secret for the configured kiosk device.                                                                                                                      |
| `INITIAL_SETUP_SECRET`                                                         | One-time deployment setup code required to create the first administrator in production.                                                                                  |
| `CORS_ORIGIN`                                                                  | Allowed browser origin when the client is hosted separately.                                                                                                              |
| `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`                | Initial Super Admin details used by the seed script.                                                                                                                      |
| `MSSQL_SERVER`, `MSSQL_PORT`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` | Optional Microsoft SQL Server registrar connection used by the direct student import.                                                                                     |
| `MSSQL_STUDENT_VIEW`                                                           | Two-part SQL Server view name, such as `dbo.vw_CredentialsDispenserStudents`.                                                                                             |
| `MSSQL_ENCRYPT`, `MSSQL_TRUST_SERVER_CERTIFICATE`                              | SQL Server TLS settings. Use `MSSQL_ENCRYPT=false` for an on-premises SQL Server without TLS; use TLS with a hostname and trusted certificate for production deployments. |

Generate the encryption key with:

```bash
openssl rand -hex 32
```

Production startup rejects missing or placeholder database, JWT, encryption, and setup settings.

## Administrator workflow

1. Open **Academic periods** and create/activate the current school year and semester before importing or creating students. When adding the first period, select **Move unassigned records** to attach existing student and voucher records.
2. Import student records and credential-account files from **Imports**, reviewing validation results first.
3. Import WiFi voucher codes from **WiFi vouchers**.
4. Let students retrieve credentials at the kiosk, or assign a voucher from a student record when needed.
5. Process password resets, account-creation requests, and replacement-voucher requests in **Credential requests**.
6. Review transactions and audit records regularly.

In **Transactions**, choose an **Academic period** to view current or historical records, then select **Export Excel** to download every transaction in that period, across all pages. Previous periods remain available even when inactive. Exported timestamps use Philippine time (UTC+08:00).

Opening **Review request** reserves that pending request for the administrator and browser tab that opened it. Other administrators see **Being reviewed** and the reviewer's name on the next queue refresh. Closing the dialog, leaving the page, completing, or rejecting releases the reservation. An open dialog renews its reservation every 20 seconds; if the browser disconnects or crashes, it becomes available again after 90 seconds without renewal. Completion and rejection require a valid review reservation. The review-lock table is created automatically when the API starts; it can also be created with `npm run migrate-request-reviews -w server`.

Most state-changing administrator functions require the **Super Admin** role, including imports, credential-request processing, voucher operations, module controls, kiosk commands, and administrator management.

### Student XLSX import with accounts

The **Students** import accepts student details and optional linked accounts in one XLSX file. Download its updated template from **Imports → Students**. Required columns are `SchoolID`, `FirstName`, `LastName`, `BirthDate` (`YYYY-MM-DD`), and `CourseCode`. Optional columns are `MiddleName`, `KumosoftID`, `YearLevel`, `EmailAddress`, `EmailPassword`, `SATPPassword`, `SchoologyPassword`, and `KumosoftPassword`.

All passwords and Kumosoft ID are optional. Blank passwords preserve saved passwords. Email addresses and Kumosoft IDs can create linked accounts without a saved password. A supplied SATP or Schoology password creates or updates that account using the School ID as its username. Kumosoft uses the supplied ID, an existing account/ID, or the School ID when neither is available. An email password without an address uses the existing email account; a new email account needs an address. Blank email and account fields leave existing accounts intact. A blank year level or Kumosoft ID preserves its saved value.

The preview includes account and year-level changes when classifying updated students. Password changes are described without displaying passwords, and identical rows remain unchanged. Student and account changes are saved in the same transaction. Existing enrollment-only files remain supported.

### SQL Server student import

The **SQL Server students** import card uses the current academic period to preview and synchronize enrolled students. New students are created, matching school IDs are updated, and active local students absent from the source list are deactivated. The preview shows the pending deactivation count before the import runs; rows whose course is not an active course in this system are reported as invalid.

**Update existing birthdays** is off by default to preserve birthdays corrected in this system. Enable it to overwrite existing birthdays with SQL Server values. New students always use the source birthday. Changing this option refreshes the review in place; importing stays disabled until the updated preview succeeds. Regular student file uploads retain their existing birthday-update behavior.

The SQL Server preview separates **Unchanged students** from updates. Only differences in imported profile fields, enabled birthday changes, course, current academic period, or active enrollment count as updates. Identical students are kept without rewriting their student rows. Students absent from the source can still be deactivated after confirmation even when every source student is unchanged.

All file imports also separate unchanged records from actual changes. Student files compare the imported profile and enrollment fields; account files compare the login, password, active status, and applicable Kumosoft ID, including accounts waiting for a matching student. Already inactive students are unchanged in deactivation imports. Existing voucher codes are unchanged and keep their current status and assignment; repeated codes within the file are listed separately as duplicates. Unchanged records are excluded from import/update counts and are not rewritten.

Updated rows in file and SQL Server import reviews list the changed fields with saved and imported values. Empty values are marked `(empty)`. Password changes show only whether the password will be replaced or cleared; the preview never includes either password. SQL Server birthday changes appear only when **Update existing birthdays** is enabled, and additional preview pages include the same change details.

Create or configure a read-only registrar view that exposes these columns: `SchoolID`, `LastName`, `FirstName`, `MiddleName`, `BirthDate`, `CourseCode`, `SchoolYear`, and `Semester`. A template for the expected registrar schema is available at [server/db/mssql-enrolled-students-view.sql](server/db/mssql-enrolled-students-view.sql). Configure its view name and a least-privilege SQL Server login with the `MSSQL_*` environment variables, then restart the API after updating `.env`.

For a local-network SQL Server that does not have TLS configured, set `MSSQL_ENCRYPT=false`. If SQL Server uses TLS, connect with its certificate hostname rather than an IP address and keep `MSSQL_ENCRYPT=true` with certificate validation enabled.

### Course levels and SATP

Set each course's **Academic level** in **Courses** to **College**, **Graduate school**, or **Other / review**. Only College students receive the SATP card, Google sign-in guidance, and SATP credentials at the kiosk. Graduate school and Other courses retain access to the other enabled services. The API also blocks SATP account requests from students outside College.

For an existing database, apply the course-level migration before restarting the updated server:

```powershell
npm run migrate-course-academic-levels -w server
npm run build
pm2 restart credentials-dispenser
```

The migration classifies recognizable degree programs and leaves ambiguous courses as Other for review. It can be rerun without resetting an administrator's classifications. Course imports accept an optional `AcademicLevel` column (`COLLEGE`, `GRADUATE_SCHOOL`, or `OTHER`). Omitting it preserves an existing course's classification; new courses are classified from their code and name when possible.

### Administrator request permissions

In **Admin users**, add or edit an administrator and choose their **Credential request permissions**. Password resets and account creation can be assigned separately for each account system; WiFi voucher requests have their own permission. These choices apply to pending and resolved requests, badge counts, and processing actions. Clearing every permission removes request access.

Use the **Request Staff** role for users who should only process assigned requests. Other access follows the selected role. The API reads current access on each call, so permission changes and account deactivation also apply to existing sessions.

The API adds the permissions column and Request Staff role automatically on startup. Existing Super Admins retain full request access until configured. The same additive migration can be run explicitly with `npm run migrate-admin-request-permissions -w server`.

## Semester voucher reset

At the end of a semester, open **WiFi vouchers** in the administrator portal and select **Clear semester vouchers**. After confirmation, the system:

1. Removes WiFi voucher links from students.
2. Permanently deletes every voucher record, including active, inactive, and released vouchers.
3. Removes related voucher-assignment history where that optional legacy table exists.

This cannot be undone. Export or back up any required information before clearing vouchers, then import the next semester's voucher list.

## Database commands

| Command                                 | Use                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run rebuild-db -w server`          | Rebuild the canonical development database. Requires `NODE_ENV=development`; destructive. |
| `npm run seed-admin -w server`          | Create the configured initial Super Admin if it does not already exist.                   |
| `npm run seed-dummy-students -w server` | Add development sample students.                                                          |
| `npm run migrate -w server`             | Run the project migration script for an existing database.                                |

The canonical development schema is [server/db/rebuild-development.sql](server/db/rebuild-development.sql). It rebuilds from scratch and must not be used against a production database.

## Project structure

```text
client/                 React + Vite interface
  src/main.jsx          Kiosk and administrator portal screens
  src/styles.css        Application styling
server/                 Express API
  controllers/          Business logic
  routes/               API routes
  middleware/           Authentication and error handling
  db/                   Schema, migrations, seeds, and database scripts
  services/             Encryption and audit helpers
```

## Security notes

- Administrator passwords are hashed with bcrypt.
- Credential passwords are encrypted with AES-256-GCM before storage.
- Administrator refresh tokens are HttpOnly, SameSite cookies that are rotated and can be revoked server-side.
- Admin API calls silently renew expired 15-minute access tokens and retry once. Concurrent calls share one renewal, including table polling, saves, imports, and exports. An expired or revoked refresh session returns to sign-in; temporary network failures do not sign the administrator out.
- Session cookies use `Secure` on HTTPS and remain usable on the supported LAN HTTP deployment. Express reads the connection scheme through the trusted proxy. [MDN documents how Secure cookies depend on HTTPS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#secure).
- Kiosk sessions are device-scoped and temporary.
- Administrative mutations are recorded in the audit log.
- Use HTTPS, restrict CORS to the real frontend origin, use a least-privilege MySQL account, and maintain tested database backups.

## Production deployment with PM2

These steps target **Windows Server** with Node.js 20+, Git, MySQL, and IIS with ARR/URL Rewrite installed. Use a dedicated Windows account for the deployment and use that same account for the PM2 Windows service.

1. In PowerShell, clone the production source and install the locked dependency set.

   ```powershell
   git clone <repository-url> C:\Apps\credentials-dispenser
   Set-Location -LiteralPath "C:\Apps\credentials-dispenser"
   npm ci --omit=dev
   ```

2. Create `.env` from `.env.example`, set `NODE_ENV=production`, and provide production database credentials, distinct JWT secrets, a 64-character encryption key, kiosk credentials, and the public `CORS_ORIGIN`. Do not use placeholder values.

   ```powershell
   Copy-Item -LiteralPath .env.example -Destination .env
   notepad .env
   ```

3. Build the React client, install PM2, and start the Express server. The server serves the built client from `client/dist`.

   ```powershell
   npm run build
   npm install --global pm2
   pm2 start npm --name credentials-dispenser -- start
   ```

4. Confirm the process and inspect startup errors.

   ```powershell
   pm2 status
   pm2 logs credentials-dispenser
   ```

5. As the deployment account, save the running process list. Then open an **elevated PowerShell** window to install PM2 as a Windows service. PM2's normal `pm2 startup` command generates startup scripts for Unix-like init systems; use the Windows service helper instead.

   ```powershell
   pm2 save
   ```

   ```powershell
   npm install --global pm2-windows-service
   pm2-service-install -n "Credentials Dispenser"
   ```

   At the installer prompts, let it configure the environment and use the default restored PM2 process list. In the Windows **Services** console, set the new service's **Log On** account to the same dedicated account that ran `pm2 save`; this ensures it can access the saved PM2 process list. Start the service and confirm it is set to start automatically.

6. Configure IIS ARR/URL Rewrite to forward `/dispenser/` to `http://127.0.0.1:3000` using [the IIS deployment guide](docs/deployment-reverse-proxy.md). Keep port `3000` private to the server and expose only IIS on HTTP/HTTPS. PM2 documents Windows startup as requiring a Windows-compatible installer, while `pm2-windows-service` restores the process list saved by `pm2 save`. [PM2 startup documentation](https://pm2.keymetrics.io/docs/usage/startup/) and [pm2-windows-service documentation](https://www.npmjs.com/package/pm2-windows-service) describe these behaviors.

### Updating a PM2 deployment

Back up the database before schema or bulk-data changes. Pull the new source, stop the managed process, install dependencies, rebuild the client, and restart it. On Windows, stop the app before `npm ci` so native modules such as `bcrypt.node` can be replaced:

```powershell
Set-Location -LiteralPath "C:\Apps\credentials-dispenser"
git pull
pm2 stop credentials-dispenser
npm ci --omit=dev
npm run build
pm2 restart credentials-dispenser
pm2 save
```

Continue to the build and restart only after installation succeeds. If Windows still reports `EPERM` for a native module, close any other `npm start` or `npm run dev` session for this project and retry installation.

The request-control migration runs automatically when the API starts. To apply it explicitly to an existing database before restarting, run `npm run migrate-credential-request-controls -w server` from the project directory. It adds missing request-control columns, carries over the old password-reset setting once, and preserves existing settings on subsequent runs. It uses the database connection in `.env` and requires permission to alter `credential_module_controls`.

Use `pm2 logs credentials-dispenser` to troubleshoot and `pm2 monit` for live process monitoring. If `.env` values change, restart the process after saving the file. After a Node.js upgrade, reinstall or update PM2 and restart the Windows service so it uses the current Node runtime.

## Production checklist

- Use strong, unique values for every secret in `.env`.
- Set `NODE_ENV=production`.
- Build the client with `npm run build` before starting the server.
- Run the app through a process manager or service supervisor.
- Terminate TLS at a reverse proxy and expose only the required application port.
- Back up MySQL before bulk changes or semester voucher clearing.
