import { Router } from "express";
import multer from "multer";
import { requireAdmin, requireRoles } from "../middleware/auth.middleware.js";
import { auditAdminMutation } from "../services/audit.service.js";
import { dashboard, listTransactions } from "../controllers/admin.controller.js";
import {
  courseOptions,
  createStudent,
  generateStudentVoucher,
  getStudent,
  listStudents,
  updateStudent,
} from "../controllers/student-admin.controller.js";
import {
  createCourse,
  importCourses,
  listCourses,
  updateCourse,
  validateCourseImport,
} from "../controllers/course-admin.controller.js";
import {
  importVouchers,
  listVouchers,
  previewVoucherRelease,
  releaseVoucherBatch,
  downloadVoucherTemplate,
  releaseVoucher,
  setVoucherStatus,
  validateVoucherImport,
} from "../controllers/voucher-admin.controller.js";
import {
  createAdminUser,
  listAdminRoles,
  listAdminUsers,
  updateAdminUser,
} from "../controllers/admin-user.controller.js";
import {
  downloadImportTemplate,
  importData,
  validateDataImport,
} from "../controllers/bulk-import.controller.js";
import {
  completePasswordResetRequest,
  listPasswordResetRequests,
  pendingCredentialRequestCount,
  rejectVoucherRequest,
} from "../controllers/password-reset.controller.js";
import {
  createReminder,
  listReminders,
  updateReminder,
} from "../controllers/reminder-admin.controller.js";
import {
  listModuleControls,
  updateModuleControl,
} from "../controllers/module-control.controller.js";
import { getKiosk, listKiosks, queueKioskAction } from "../controllers/kiosk-admin.controller.js";

export const adminRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});
adminRouter.use(requireAdmin);
adminRouter.get("/dashboard", dashboard);
adminRouter.get("/transactions", listTransactions);
adminRouter.get("/password-reset-requests", requireRoles("Super Admin"), listPasswordResetRequests);
adminRouter.get("/password-reset-requests/pending-count", requireRoles("Super Admin"), pendingCredentialRequestCount);
adminRouter.patch("/password-reset-requests/:id/complete", requireRoles("Super Admin"), auditAdminMutation("COMPLETE", "CREDENTIAL_REQUEST"), completePasswordResetRequest);
adminRouter.patch("/password-reset-requests/:id/reject", requireRoles("Super Admin"), auditAdminMutation("REJECT", "CREDENTIAL_REQUEST"), rejectVoucherRequest);
adminRouter.get("/reminders", listReminders);
adminRouter.post("/reminders", requireRoles("Super Admin"), auditAdminMutation("CREATE", "KIOSK_REMINDER"), createReminder);
adminRouter.patch("/reminders/:id", requireRoles("Super Admin"), auditAdminMutation("UPDATE", "KIOSK_REMINDER"), updateReminder);
adminRouter.get("/module-controls", requireRoles("Super Admin"), listModuleControls);
adminRouter.patch("/module-controls/:module", requireRoles("Super Admin"), auditAdminMutation("UPDATE", "MODULE_CONTROL"), updateModuleControl);
adminRouter.get("/kiosks", requireRoles("Super Admin"), listKiosks);
adminRouter.get("/kiosks/:id", requireRoles("Super Admin"), getKiosk);
adminRouter.post("/kiosks/:id/actions", requireRoles("Super Admin"), auditAdminMutation("QUEUE_COMMAND", "KIOSK"), queueKioskAction);
adminRouter.get("/admin-users", requireRoles("Super Admin"), listAdminUsers);
adminRouter.post("/admin-users", requireRoles("Super Admin"), auditAdminMutation("CREATE", "ADMIN_USER"), createAdminUser);
adminRouter.patch("/admin-users/:id", requireRoles("Super Admin"), auditAdminMutation("UPDATE", "ADMIN_USER"), updateAdminUser);
adminRouter.get("/admin-roles", requireRoles("Super Admin"), listAdminRoles);
adminRouter.get("/imports/:type/template", downloadImportTemplate);
adminRouter.post("/imports/:type/validate", upload.single("file"), validateDataImport);
adminRouter.post("/imports/:type", requireRoles("Super Admin"), auditAdminMutation("IMPORT", "BULK_IMPORT"), upload.single("file"), importData);
adminRouter.get("/students", listStudents);
adminRouter.post("/students", requireRoles("Super Admin"), auditAdminMutation("CREATE", "STUDENT"), createStudent);
adminRouter.patch("/students/:id", requireRoles("Super Admin"), auditAdminMutation("UPDATE", "STUDENT"), updateStudent);
adminRouter.post("/students/:id/voucher/generate", requireRoles("Super Admin"), auditAdminMutation("ASSIGN", "VOUCHER"), generateStudentVoucher);
adminRouter.get("/students/:id", requireRoles("Super Admin"), getStudent);
adminRouter.get("/voucher-records", listVouchers);
adminRouter.get("/voucher-records/release/preview", previewVoucherRelease);
adminRouter.post("/voucher-records/release", requireRoles("Super Admin"), auditAdminMutation("RELEASE_BATCH", "VOUCHER"), releaseVoucherBatch);
adminRouter.get("/voucher-records/import/template", downloadVoucherTemplate);
adminRouter.post("/voucher-records/import/validate", upload.single("file"), validateVoucherImport);
adminRouter.post("/voucher-records/import", requireRoles("Super Admin"), auditAdminMutation("IMPORT", "VOUCHER"), upload.single("file"), importVouchers);
adminRouter.post("/voucher-records/:id/release", requireRoles("Super Admin"), auditAdminMutation("RELEASE", "VOUCHER"), releaseVoucher);
adminRouter.patch("/voucher-records/:id/status", requireRoles("Super Admin"), auditAdminMutation("UPDATE_STATUS", "VOUCHER"), setVoucherStatus);
adminRouter.get("/courses", courseOptions);
adminRouter.get("/course-records", listCourses);
adminRouter.post("/course-records", requireRoles("Super Admin"), auditAdminMutation("CREATE", "COURSE"), createCourse);
adminRouter.patch("/course-records/:id", requireRoles("Super Admin"), auditAdminMutation("UPDATE", "COURSE"), updateCourse);
adminRouter.post(
  "/course-records/import/validate",
  upload.single("file"),
  validateCourseImport,
);
adminRouter.post(
  "/course-records/import",
  requireRoles("Super Admin"), auditAdminMutation("IMPORT", "COURSE"), upload.single("file"),
  importCourses,
);
