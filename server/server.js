import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { kioskRouter } from "./routes/kiosk.routes.js";
import { errorHandler } from "./middleware/errorHandler.middleware.js";
import { ensureAdminRequestPermissionsSchema } from "./services/admin-request-permissions.service.js";
import { ensureRequestReviewSchema } from "./services/request-review.service.js";
import { ensureKioskActivitySchema } from "./services/kiosk-activity.service.js";
import { ensureCredentialRequestControlsSchema } from "./services/credential-request-controls.service.js";
const app = express(),
  cfg = config();
const BASE_PATH = "/dispenser";
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    // This deployment is intentionally available on the internal LAN over
    // HTTP. Helmet's default `upgrade-insecure-requests` directive upgrades
    // every CSS/JS/image request to HTTPS; because the LAN IP does not have a
    // trusted HTTPS certificate, the browser blocks those assets and shows a
    // blank page.
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: null },
    },
  }),
);
app.use(
  cors({
    origin: cfg.corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Kiosk-Code",
      "X-Kiosk-Secret",
    ],
    credentials: true,
  }),
);
app.use(express.json({ limit: "32kb" }));
app.get(`${BASE_PATH}/api/health`, (_req, res) => res.json({ status: "ok" }));
app.use(`${BASE_PATH}/api/auth`, authRouter);
app.use(`${BASE_PATH}/api/admin`, adminRouter);
app.use(`${BASE_PATH}/api/kiosk`, kioskRouter);
const directory = path.dirname(fileURLToPath(import.meta.url));
const clientBuild = path.resolve(directory, "../client/dist");
app.get("/", (_req, res) => res.redirect(BASE_PATH));
app.use(BASE_PATH, express.static(clientBuild, { index: false, maxAge: "1h" }));
// Express 5 requires a named wildcard parameter; `{*splat}` also covers the
// base path itself.
app.get(`${BASE_PATH}/{*splat}`, (req, res, next) =>
  req.path.startsWith(`${BASE_PATH}/api/`)
    ? next()
    : res.sendFile(path.join(clientBuild, "index.html")),
);
app.use(errorHandler);
await ensureAdminRequestPermissionsSchema();
await ensureRequestReviewSchema();
await ensureKioskActivitySchema();
await ensureCredentialRequestControlsSchema();
app.listen(cfg.port, cfg.listenHost, () =>
  console.log(
    `Credentials API listening on http://${cfg.listenHost}:${cfg.port}`,
  ),
);
