# IIS reverse-proxy deployment

The Credentials Dispenser is exposed through IIS at:

```text
http://<server-name-or-ip>/dispenser/
```

IIS owns public port 80 (and 443 when TLS is configured). The Node.js server
remains private at `127.0.0.1:3000` and serves the client and API beneath
`/dispenser`.

## 1. Prepare the application

Build the client and start the server through PM2 (or the process manager used
by the server):

```powershell
npm run build
pm2 restart ndmu-credentials-dispenser
Invoke-WebRequest http://127.0.0.1:3000/dispenser/api/health
```

The health request must return JSON before configuring IIS.

### LAN HTTP safeguard

For an internal HTTP deployment, run this after every server restart or update:

```powershell
npm run verify:lan-http
```

It verifies that the page does not send the `upgrade-insecure-requests` policy
and that its JavaScript bundle is available over HTTP. That policy must remain
disabled unless IIS has a valid, trusted HTTPS certificate for the URL used by
the kiosk; otherwise browsers block the application assets and display a blank
page.

## 2. Configure IIS

1. Install **IIS URL Rewrite Module 2** and **Application Request Routing
   (ARR)**.
2. In IIS Manager, select the server, open **Application Request Routing
   Cache**, choose **Server Proxy Settings**, then enable **Proxy**.
3. Use the IIS site that owns port 80, usually **Default Web Site**. Make sure
   no Nginx process is running or bound to ports 80/443.
4. Copy [deployment/iis/web.config](../deployment/iis/web.config) to that
   site's physical root. If the site already has a `web.config`, merge the two
   `dispenser` rules into its existing `<rules>` element instead of replacing
   its configuration.

The rules redirect `/dispenser` to `/dispenser/`, then forward every
`/dispenser/...` request unchanged to Node. This includes static assets and
`/dispenser/api/...` requests.

## 3. Verify

Open:

```text
http://localhost/dispenser/
http://localhost/dispenser/admin
http://localhost/dispenser/api/health
```

Sign in to the administrator portal and complete one kiosk verification. If
the browser displays a blank page, confirm that requests under
`/dispenser/assets/` return JavaScript/CSS rather than IIS HTML.

## Updating

For application changes, stop the app before reinstalling dependencies, then rebuild and restart Node. Windows cannot replace a native module such as `bcrypt.node` while a running process has it loaded:

```powershell
Set-Location -LiteralPath "C:\path\to\Dispenser System"
pm2 stop ndmu-credentials-dispenser
npm ci
npm run build
pm2 restart ndmu-credentials-dispenser
```

Run the build and restart only after `npm ci` succeeds. Close any other development or server terminal for this project if a native module remains locked.

For proxy-rule changes, update the IIS site's `web.config` and restart the IIS
site or run this from an elevated PowerShell window:

```powershell
iisreset
```

Do not expose Node port 3000 through Windows Firewall or externally. Configure
TLS at IIS before exposing the system outside the local network.
