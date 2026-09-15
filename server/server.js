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
app.disable("x-powered-by");
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
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/kiosk", kioskRouter);
const directory = path.dirname(fileURLToPath(import.meta.url));
const clientBuild = path.resolve(directory, "../client/dist");
app.use(express.static(clientBuild, { index: false, maxAge: "1h" }));
app.get("*", (req, res, next) =>
  req.path.startsWith("/api/")
    ? next()
    : res.sendFile(path.join(clientBuild, "index.html")),
);
app.use(errorHandler);
app.listen(cfg.port, () =>
  console.log(`Credentials API listening on ${cfg.port}`),
);
