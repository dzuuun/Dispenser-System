import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createKioskSession, requireKiosk } from "../middleware/kioskAuth.middleware.js";
import { publicModuleControls } from "../controllers/module-control.controller.js";
import {
  courses,
  verify,
  credentials,
  endSession,
  requestPasswordReset,
  reminders,
  revealCredentials,
  requestAccount,
  requestNewVoucher,
} from "../controllers/kiosk.controller.js";
import { completeKioskCommand, kioskHeartbeat } from "../controllers/kiosk-admin.controller.js";
export const kioskRouter = Router();
kioskRouter.post("/session", rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: true, legacyHeaders: false, message: { message: "Too many kiosk enrollment attempts. Please try again later." } }), createKioskSession);
kioskRouter.use(requireKiosk);
kioskRouter.get("/courses", courses);
kioskRouter.get("/reminders", reminders);
kioskRouter.get("/module-controls", publicModuleControls);
kioskRouter.post("/heartbeat", kioskHeartbeat);
kioskRouter.post("/commands/complete", completeKioskCommand);
kioskRouter.post(
  "/verify",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: "Too many verification attempts. Please try again later.",
    },
  }),
  verify,
);
kioskRouter.get("/credentials", credentials);
kioskRouter.post("/credentials/reveal", revealCredentials);
kioskRouter.post(
  "/password-reset-requests",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many reset requests. Please try again later." },
  }),
  requestPasswordReset,
);
kioskRouter.post(
  "/account-requests",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many account requests. Please try again later." },
  }),
  requestAccount,
);
kioskRouter.post(
  "/voucher-requests",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 4,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many voucher requests. Please try again later." },
  }),
  requestNewVoucher,
);
kioskRouter.post("/end-session", endSession);
