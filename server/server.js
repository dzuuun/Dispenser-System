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
const app = express(),
  cfg = config();
const BASE_PATH = "/dispenser";
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(helmet({ crossOriginResourcePolicy: false }));
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
app.get(`${BASE_PATH}/*`, (req, res, next) =>
  req.path.startsWith(`${BASE_PATH}/api/`)
    ? next()
    : res.sendFile(path.join(clientBuild, "index.html")),
);
app.use(errorHandler);
app.listen(cfg.port, "127.0.0.1", () =>
  console.log(`Credentials API listening on ${cfg.port}`),
);
