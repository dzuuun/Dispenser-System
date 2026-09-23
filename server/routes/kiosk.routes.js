import { Router } from "express";
import {
  createKioskSession,
  requireKiosk,
} from "../middleware/kioskAuth.middleware.js";
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
import {
  completeKioskCommand,
  kioskHeartbeat,
} from "../controllers/kiosk-admin.controller.js";
export const kioskRouter = Router();
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch(next);
kioskRouter.post("/session", asyncRoute(createKioskSession));
kioskRouter.use(asyncRoute(requireKiosk));
kioskRouter.get("/courses", asyncRoute(courses));
kioskRouter.get("/reminders", asyncRoute(reminders));
kioskRouter.get("/module-controls", asyncRoute(publicModuleControls));
kioskRouter.post("/heartbeat", asyncRoute(kioskHeartbeat));
kioskRouter.post("/commands/complete", asyncRoute(completeKioskCommand));
kioskRouter.post("/verify", asyncRoute(verify));
kioskRouter.get("/credentials", asyncRoute(credentials));
kioskRouter.post("/credentials/reveal", asyncRoute(revealCredentials));
kioskRouter.post("/password-reset-requests", asyncRoute(requestPasswordReset));
kioskRouter.post("/account-requests", asyncRoute(requestAccount));
kioskRouter.post("/voucher-requests", asyncRoute(requestNewVoucher));
kioskRouter.post("/end-session", asyncRoute(endSession));
