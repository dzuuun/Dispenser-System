import { Router } from "express";
import {
  login,
  logout,
  me,
  refresh,
  setup,
  setupStatus,
} from "../controllers/auth.controller.js";
import { requireAdmin } from "../middleware/auth.middleware.js";
export const authRouter = Router();
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
authRouter.get("/setup-status", asyncRoute(setupStatus));
authRouter.post("/setup", asyncRoute(setup));
authRouter.post("/login", asyncRoute(login));
authRouter.post("/refresh", asyncRoute(refresh));
authRouter.post("/logout", asyncRoute(logout));
authRouter.get("/me", requireAdmin, me);
