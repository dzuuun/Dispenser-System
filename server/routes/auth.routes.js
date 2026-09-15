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
import rateLimit from "express-rate-limit";
export const authRouter = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { message: "Too many authentication attempts. Please try again in 15 minutes." } });
authRouter.get("/setup-status", setupStatus);
authRouter.post("/setup", authLimiter, setup);
authRouter.post("/login", authLimiter, login);
authRouter.post("/refresh", authLimiter, refresh);
authRouter.post("/logout", logout);
authRouter.get("/me", requireAdmin, me);
