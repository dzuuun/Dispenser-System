import React, { Component, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import DataTable from "datatables.net-react";
import DT from "datatables.net-dt";
import "datatables.net-dt/css/dataTables.dataTables.css";
import "material-symbols/rounded.css";
import "./styles.css";
import ndmuLogo from "./assets/ndmu-logo.png";
import { generateRandomPassword } from "./password-generator.js";
import { createPendingRequestTitle } from "./pending-request-title.js";
import { createKioskActivityTracker } from "./kiosk-activity.js";
import { createAdminApi } from "./admin-api.js";
import {
  dateSearchText,
  matchesTableSearch,
  kioskSearchValues,
} from "./table-search.js";
import {
  ACCOUNT_REQUEST_MODULES,
  PASSWORD_RESET_MODULES,
  credentialRequestOptions,
} from "../../shared/credential-request-controls.mjs";
import {
  DEFAULT_PASSWORD_RESET_FOLLOW_UP,
  NEW_PASSWORD_RESET_FOLLOW_UP,
  passwordResetGuidance,
} from "./password-reset-guidance.js";
import {
  REQUEST_PERMISSION_GROUPS,
  REQUEST_PERMISSION_KEYS,
  effectiveRequestPermissions,
} from "../../shared/request-permissions.mjs";

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") || "";
const API = `${APP_BASE}/api`;
const adminApi = createAdminApi({
  baseUrl: API,
  onToken: (token) =>
    dispatchEvent(new CustomEvent("admin-token-refreshed", { detail: token })),
  onExpired: () => dispatchEvent(new Event("admin-session-expired")),
});
const adminFetch = (path, options) => adminApi.fetch(path, options);
DataTable.use(DT);
const kioskHeaders = {
  "Content-Type": "application/json",
  "X-Kiosk-Code": import.meta.env.VITE_KIOSK_CODE || "KIOSK-MIS-01",
};
const KIOSK_STARTED_AT = Date.now();
const kioskIdentity = {
  name: import.meta.env.VITE_KIOSK_NAME || "",
  location: import.meta.env.VITE_KIOSK_LOCATION || "",
};
async function request(path, options = {}) {
  const res = await adminFetch(path, options);
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok)
    throw Object.assign(new Error(data?.message || "Unable to continue."), {
      status: res.status,
    });
  return data;
}

function addDataTablePageJump() {
  const api = this.api();
  const container = api.table().container();
  const paging = container.querySelector(".dt-paging");
  if (!paging || paging.querySelector(".dt-page-jump")) return;

  const form = document.createElement("form");
  form.className = "dt-page-jump";
  form.setAttribute("aria-label", "Jump to page");
  form.innerHTML =
    '<label>Go to page <input type="number" min="1" inputmode="numeric" aria-label="Page number"></label>';
  const input = form.querySelector("input");
  const update = () => {
    const info = api.page.info();
    input.max = String(Math.max(1, info.pages));
    input.value = String(info.page + 1);
    form.hidden = info.pages < 2;
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const page = Number(input.value);
    const pages = api.page.info().pages;
    if (Number.isInteger(page) && page >= 1 && page <= pages)
      api.page(page - 1).draw("page");
    update();
  });
  paging.append(form);
  api.on("draw.pageJump", update);
  update();
}
const appPath = () => {
  const path = location.pathname;
  return APP_BASE && path.startsWith(APP_BASE)
    ? path.slice(APP_BASE.length) || "/"
    : path;
};
const go = (path) => {
  history.pushState({}, "", `${APP_BASE}${path}`);
  dispatchEvent(new PopStateEvent("popstate"));
};
function usePath() {
  const [route, setRoute] = useState({ path: appPath(), revision: 0 });
  useEffect(() => {
    const update = () =>
      setRoute((current) => ({
        path: appPath(),
        revision: current.revision + 1,
      }));
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  return route;
}
function Button({ children, onClick, variant = "primary", disabled = false }) {
  return (
    <button
      type="button"
      className={`btn ${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function InactiveRecordsToggle({ visible, onChange }) {
  return (
    <button
      type="button"
      className="btn secondary"
      aria-pressed={visible}
      onClick={() => onChange(!visible)}
    >
      {visible ? "Hide inactive" : "Show inactive"}
    </button>
  );
}
function RecordsTableControls({
  search,
  onSearchChange,
  searchLabel,
  searchPlaceholder,
  pageSize,
  onPageSizeChange,
  pageSizeLabel = "Rows per page",
}) {
  return (
    <div className="records-table-controls">
      <label className="records-table-field records-table-search">
        <span>{searchLabel}</span>
        <span className="records-table-search-input">
          <AppIcon name="search" size={18} />
          <input
            type="search"
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            maxLength={200}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </span>
      </label>
      <label className="records-table-field records-table-page-size">
        <span>Rows per page</span>
        <select
          aria-label={pageSizeLabel}
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {[10, 25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
function RequestValueField({ label, value, onCopy }) {
  return (
    <div className="request-value-field">
      <span>{label}</span>
      <div className="request-value-control">
        <code>{value || "Unavailable"}</code>
        {onCopy && (
          <button
            type="button"
            className="btn secondary request-value-copy"
            disabled={!value}
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={onCopy}
          >
            <AppIcon name="content_copy" size={16} /> Copy
          </button>
        )}
      </div>
    </div>
  );
}
function RequestPasswordField({ label, value, onChange, onGenerate, saving }) {
  return (
    <div className="request-password-field">
      <label className="field">
        <span>{label}</span>
        <input
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`Enter the ${label.toLowerCase()}`}
        />
      </label>
      <div className="request-password-actions">
        <Button variant="secondary" disabled={saving} onClick={onGenerate}>
          <AppIcon name="refresh" size={18} /> Generate password
        </Button>
      </div>
    </div>
  );
}
function ResolvedRequestDetails({ request, onCopy }) {
  const requestType =
    {
      PASSWORD_RESET: "Password reset",
      ACCOUNT_CREATION: "Account creation",
      VOUCHER_REQUEST: "Voucher replacement",
    }[request.request_kind] || request.request_kind;
  const formatTime = (value) =>
    value ? new Date(value).toLocaleString() : "Not recorded";
  const facts = [
    ["Request type", requestType],
    ["Course", request.course_code || "Not recorded"],
    ["Requested", formatTime(request.requested_at)],
    ["Resolved", formatTime(request.resolved_at)],
    ["Handled by", request.resolved_by_name || "Not recorded"],
    ["Kiosk", request.kiosk_code || "Not recorded"],
  ];
  return (
    <>
      <div className="request-resolution-summary">
        <b>Request #{request.id}</b>
        <Status tone={request.status === "REJECTED" ? "danger" : "green"}>
          {request.status === "REJECTED" ? "Rejected" : "Completed"}
        </Status>
      </div>
      <dl className="request-detail-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {request.request_kind === "VOUCHER_REQUEST" ? (
        <RequestValueField
          label="Current voucher"
          value={request.account_username}
          onCopy={() => onCopy(request.account_username, "Voucher")}
        />
      ) : (
        <div className="request-account-values">
          <RequestValueField
            label={
              request.credential_type === "EMAIL" ? "Email address" : "Username"
            }
            value={request.account_username}
            onCopy={() =>
              onCopy(
                request.account_username,
                request.credential_type === "EMAIL"
                  ? "Email address"
                  : "Username",
              )
            }
          />
          <RequestValueField
            label="Current default password"
            value={request.default_password}
            onCopy={() => onCopy(request.default_password, "Default password")}
          />
        </div>
      )}
      {request.request_reason && (
        <div className="request-reason-details">
          <b>Student's reason</b>
          <p>{request.request_reason}</p>
        </div>
      )}
    </>
  );
}
function ConfirmModal({
  title = "Confirm action",
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onClose,
}) {
  return (
    <div className="modal-backdrop system-modal-backdrop" onMouseDown={onClose}>
      <section
        className="system-modal confirm-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="eyebrow">CONFIRM ACTION</p>
        <h2>{title}</h2>
        <p>{message}</p>
        <footer>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </footer>
      </section>
    </div>
  );
}

const ACCOUNT_REQUEST_FOLLOW_UP =
  "Return to this kiosk after at least two business hours to check your new account credentials.";

function CredentialRequestInfoModal({
  accountTitle,
  requestKind,
  hasDefaultPassword,
  checkForNewPassword,
  submitting,
  onSubmit,
  onClose,
}) {
  const creatingAccount = requestKind === "ACCOUNT_CREATION";
  const useDefaultPassword = hasDefaultPassword && !checkForNewPassword;
  return (
    <div
      className="modal-backdrop system-modal-backdrop"
      onMouseDown={submitting ? undefined : onClose}
    >
      <section
        className={`system-modal system-modal--informational password-reset-info-modal${creatingAccount ? " account-request-info-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credential-request-info-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">
          {creatingAccount ? "ACCOUNT REQUEST" : "PASSWORD RESET REQUEST"}
        </p>
        <h2 id="credential-request-info-title">
          {creatingAccount
            ? `Request your ${accountTitle} account?`
            : `Reset your ${accountTitle} password?`}
        </h2>
        <p>
          {creatingAccount
            ? "This sends an account creation request to the ICT/MIS administrator. Your account will not be available immediately."
            : "This sends a request to the ICT/MIS administrator. Your password will not change immediately."}
        </p>
        <div className="password-reset-info-list">
          <article>
            <AppIcon name="schedule" size={22} />
            <span>
              <b>When to expect it</b>
              <small>
                Allow at least two business hours for processing. Requests are
                processed during regular ICT/MIS office hours.
              </small>
            </span>
          </article>
          <article>
            <AppIcon name="notifications" size={22} />
            <span>
              <b>How you will know</b>
              <small>
                {creatingAccount ? (
                  <>
                    {ACCOUNT_REQUEST_FOLLOW_UP} The pending label will disappear
                    once your account is created.
                  </>
                ) : useDefaultPassword ? (
                  <>
                    Once the administrator completes the reset, you can sign in
                    with the default credentials shown here.
                  </>
                ) : (
                  <>
                    Return to this kiosk after at least two business hours to
                    check the status. The pending label will disappear once the
                    reset is completed.
                  </>
                )}
              </small>
            </span>
          </article>
          <article>
            <AppIcon name="password" size={22} />
            <span>
              <b>
                {creatingAccount
                  ? "View your new account credentials"
                  : useDefaultPassword
                    ? "Sign in with your default credentials"
                    : checkForNewPassword
                      ? "Check for your new password"
                      : "Check your account credentials"}
              </b>
              <small>
                {creatingAccount ? (
                  <>
                    Once your account is created, open Credentials Summary and
                    tap Show All to view your username and password.
                    {accountTitle === "Kumosoft" && (
                      <>
                        {" "}
                        You can also select <strong>
                          Sign in with Google
                        </strong>{" "}
                        on Kumosoft using your institutional email account.
                      </>
                    )}
                  </>
                ) : useDefaultPassword ? (
                  <>
                    {DEFAULT_PASSWORD_RESET_FOLLOW_UP} Tap Show All in
                    Credentials Summary to view your username and default
                    password.
                  </>
                ) : checkForNewPassword ? (
                  <>
                    {NEW_PASSWORD_RESET_FOLLOW_UP} Tap Show All in Credentials
                    Summary to view your updated password once the reset is
                    completed.
                  </>
                ) : (
                  <>
                    No default password is currently available. Return to this
                    kiosk after at least two business hours to check the reset
                    status and your updated account credentials.
                  </>
                )}
              </small>
            </span>
          </article>
        </div>
        <footer>
          <button
            type="button"
            className="btn secondary"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={submitting}
            onClick={onSubmit}
          >
            {submitting ? "Submitting..." : "Submit request"}
          </button>
        </footer>
      </section>
    </div>
  );
}
function VoucherRequestModal({
  reason,
  submitting,
  onReasonChange,
  onSubmit,
  onClose,
}) {
  const valid = reason.trim().length >= 10;
  return (
    <div
      className="modal-backdrop system-modal-backdrop"
      onMouseDown={submitting ? undefined : onClose}
    >
      <section
        className="system-modal system-modal--informational voucher-request-info-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">NEW VOUCHER REQUEST</p>
        <h2>Why do you need a new voucher?</h2>
        <p>
          Your current voucher remains active while this request waits for
          administrator approval.
        </p>
        <label className="field voucher-request-reason">
          <span>Reason for replacement</span>
          <textarea
            autoFocus
            rows="4"
            minLength="10"
            maxLength="500"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Explain what happened to your current voucher..."
          />
          <small>{reason.trim().length} / 500 characters · Minimum 10</small>
        </label>
        <div className="voucher-request-note">
          <AppIcon name="approval" size={22} />
          <span>
            <b>Administrator approval required</b>
            <small>
              If approved, the old voucher will be released and a new available
              voucher will be assigned.
            </small>
          </span>
        </div>
        <footer>
          <button
            type="button"
            className="btn secondary"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={submitting || !valid}
            onClick={onSubmit}
          >
            {submitting ? "Submitting..." : "Submit request"}
          </button>
        </footer>
      </section>
    </div>
  );
}
function LoadingModal({
  title = "Please wait",
  message = "Your request is being processed.",
}) {
  return (
    <div className="modal-backdrop system-modal-backdrop">
      <section className="system-modal loading-modal" role="status">
        <span className="loading-spinner" />
        <div>
          <p className="loading-modal-label">PLEASE WAIT</p>
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <span className="loading-progress" aria-hidden="true">
          <i />
        </span>
      </section>
    </div>
  );
}
function AppIcon({ name, size = 18 }) {
  const materialName =
    {
      eye: "visibility",
      eyeOff: "visibility_off",
      settings: "settings",
      students: "school",
      requests: "pending_actions",
      kiosk: "desktop_windows",
    }[name] || name;
  return (
    <span
      className="material-symbols-rounded app-icon"
      style={{ fontSize: `${size}px` }}
      aria-hidden="true"
    >
      {materialName}
    </span>
  );
}
function Toast({ message, onClose, tone = "success" }) {
  const isError = tone === "error";
  return (
    <div
      className={`toast-notification${isError ? " error-toast" : ""}`}
      role={isError ? "alert" : "status"}
    >
      <span>
        <AppIcon name={isError ? "error" : "check"} size={17} />
      </span>
      <p>{message}</p>
      <button onClick={onClose} aria-label="Dismiss">
        <AppIcon name="close" size={19} />
      </button>
    </div>
  );
}
function Status({ children, tone = "green" }) {
  return <span className={`status ${tone}`}>{children}</span>;
}
function Empty({ title, detail, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <AppIcon name="inbox" size={20} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function Brand({ compact = false, light = false }) {
  return (
    <div
      className={`ndmu-brand ${compact ? "compact" : ""} ${light ? "light" : ""}`}
    >
      <img src={ndmuLogo} alt="Notre Dame of Marbel University seal" />
      <span>
        <b>Notre Dame of Marbel University</b>
        <small>
          {compact ? "Credentials Dispenser" : "Excellence through service"}
        </small>
      </span>
    </div>
  );
}

function SetupPage() {
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    password: "",
    setupSecret: "",
  });
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    request("/auth/setup-status")
      .then(({ required }) => (required ? setReady(true) : go("/admin")))
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const session = await request("/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      go("/admin");
    } catch (err) {
      setError(err.message);
    }
  };
  if (!ready)
    return <main className="setup-page">Checking initial setup...</main>;
  return (
    <main className="setup-page">
      <section className="setup-card">
        <aside className="setup-aside">
          <Brand light />
          <span className="setup-kicker">CREDENTIALS DISPENSER</span>
          <h1>
            Set up your
            <br />
            workspace.
          </h1>
          <p>
            Create the first administrator account to manage credentials and
            kiosk access securely.
          </p>
          <div className="setup-step">
            <b>1</b> One-time administrator setup
          </div>
        </aside>
        <section className="setup-form-panel">
          <div className="setup-title">
            <span className="setup-icon">
              <AppIcon name="admin_panel_settings" size={24} />
            </span>
            <div>
              <span className="setup-kicker">INITIAL SETUP</span>
              <h2>Create administrator</h2>
              <p>This page is disabled automatically after setup.</p>
            </div>
          </div>
          <form onSubmit={submit}>
            <div className="name-grid">
              <Field
                label="First name"
                value={form.firstName}
                onChange={(v) => setForm({ ...form, firstName: v })}
              />
              <Field
                label="Middle name (optional)"
                value={form.middleName}
                onChange={(v) => setForm({ ...form, middleName: v })}
              />
            </div>
            <Field
              label="Last name"
              value={form.lastName}
              onChange={(v) => setForm({ ...form, lastName: v })}
            />
            <Field
              label="Institutional email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <Field
              label="Password (minimum 12 characters)"
              type="password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
            />
            <Field
              label="Deployment setup code"
              type="password"
              value={form.setupSecret}
              onChange={(v) => setForm({ ...form, setupSecret: v })}
            />
            {error && <p className="error">{error}</p>}
            <button className="btn primary wide">
              Create administrator <AppIcon name="arrow_forward" size={18} />
            </button>
          </form>
          <p className="setup-help">
            The first account receives full Super Admin access.
          </p>
        </section>
      </section>
    </main>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  revealPassword = false,
  passwordVisible = false,
  onPasswordVisibilityChange,
}) {
  const schoolId = label === "School ID";
  const visibleAccountPassword =
    label.toLowerCase().includes("password") &&
    label.toLowerCase().includes("optional");
  const emailField = label.toLowerCase().startsWith("institutional email")
    ? " email-address-field"
    : label.toLowerCase().startsWith("email password")
      ? " email-password-field"
      : "";
  const kumosoftField = label.toLowerCase().startsWith("kumosoft password")
    ? " kumosoft-password-field"
    : "";
  const canRevealPassword =
    revealPassword && type === "password" && !visibleAccountPassword;
  return (
    <label className={`field${emailField}${kumosoftField}`}>
      <span>{label}</span>
      <span className={canRevealPassword ? "password-field-control" : ""}>
        <input
          type={
            visibleAccountPassword || (canRevealPassword && passwordVisible)
              ? "text"
              : type
          }
          required={label.includes("optional") ? false : undefined}
          placeholder={placeholder || label.replace(/\s*\(.+\)/, "")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {canRevealPassword && (
          <button
            type="button"
            onClick={() => onPasswordVisibilityChange?.(!passwordVisible)}
            aria-label={passwordVisible ? "Hide password" : "Show password"}
          >
            <AppIcon
              name={passwordVisible ? "visibility_off" : "visibility"}
              size={19}
            />
            {passwordVisible ? "Hide" : "Show"}
          </button>
        )}
      </span>
      {schoolId && (
        <small className="field-hint">
          Used as the SATP and Schoology username. Kumosoft uses the Kumosoft ID
          when provided.
        </small>
      )}
    </label>
  );
}

const navGroups = [
  ["Overview", "/admin", "Dashboard", "dashboard"],
  ["Records", "/admin/students", "Students", "school"],
  ["Courses", "/admin/courses", "Courses", "menu_book"],
  ["Vouchers", "/admin/vouchers", "WiFi vouchers", "confirmation_number"],
  [
    "ReleaseVouchers",
    "/admin/release-vouchers",
    "Release vouchers",
    "assignment_turned_in",
  ],
  ["Imports", "/admin/imports", "Imports", "upload_file"],
  [
    "ResetRequests",
    "/admin/password-resets",
    "Credential requests",
    "pending_actions",
  ],
  ["Monitoring", "/admin/transactions", "Transactions", "receipt_long"],
  ["Kiosks", "/admin/kiosks", "Kiosks", "desktop_windows"],
  ["Reminders", "/admin/reminders", "Kiosk reminders", "notifications"],
  ["Controls", "/admin/module-controls", "Credential controls", "tune"],
  ["Administration", "/admin/users", "Admin users", "admin_panel_settings"],
  ["Periods", "/admin/academic-periods", "Academic periods", "calendar_month"],
];
function AdminShell({ children, path, onLogout, token, admin }) {
  const requestOnly = admin?.role === "Request Staff";
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarPreview, setSidebarPreview] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [activePeriod, setActivePeriod] = useState(null);
  const pendingCountRequestInFlight = useRef(false);
  const pendingRequestTitle = useRef(null);
  const currentAdminPath = useRef(path);
  currentAdminPath.current = path;
  const dismissingSidebarClick = useRef(false);
  const sidebarOpen = sidebarPinned || sidebarPreview;
  const isViewingRequestQueue = () =>
    currentAdminPath.current === "/admin/password-resets" &&
    document.visibilityState === "visible" &&
    document.hasFocus();
  useEffect(() => {
    const title = createPendingRequestTitle({ document });
    pendingRequestTitle.current = title;
    const acknowledge = () => {
      if (isViewingRequestQueue()) title.acknowledge();
    };
    window.addEventListener("focus", acknowledge);
    document.addEventListener("visibilitychange", acknowledge);
    return () => {
      window.removeEventListener("focus", acknowledge);
      document.removeEventListener("visibilitychange", acknowledge);
      pendingRequestTitle.current = null;
      title.dispose();
    };
  }, []);
  useEffect(() => {
    if (isViewingRequestQueue()) pendingRequestTitle.current?.acknowledge();
  }, [path]);
  useEffect(() => {
    let active = true;
    const loadPendingCount = async () => {
      if (pendingCountRequestInFlight.current) return;
      pendingCountRequestInFlight.current = true;
      try {
        const result = await request(
          "/admin/password-reset-requests/pending-count",
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (active) {
          setPendingRequestCount(Number(result.count) || 0);
          pendingRequestTitle.current?.update(result, isViewingRequestQueue());
        }
      } catch {
        // Keep the last known badge count if a short refresh fails.
      } finally {
        pendingCountRequestInFlight.current = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadPendingCount();
    };
    loadPendingCount();
    const timer = setInterval(loadPendingCount, 3000);
    window.addEventListener("focus", loadPendingCount);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("credential-requests-updated", loadPendingCount);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", loadPendingCount);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener(
        "credential-requests-updated",
        loadPendingCount,
      );
    };
  }, [token]);
  useEffect(() => {
    let active = true;
    if (requestOnly) return;
    const loadPeriod = () =>
      request("/admin/academic-periods", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((periods) => {
          if (active)
            setActivePeriod(periods.find((period) => period.isCurrent) || null);
        })
        .catch(() => {
          if (active) setActivePeriod(null);
        });
    loadPeriod();
    window.addEventListener("academic-period-updated", loadPeriod);
    return () => {
      active = false;
      window.removeEventListener("academic-period-updated", loadPeriod);
    };
  }, [token, requestOnly]);
  const closeSidebarFromMain = (event) => {
    if (event.type === "click" && dismissingSidebarClick.current) {
      event.preventDefault();
      event.stopPropagation();
      dismissingSidebarClick.current = false;
      return;
    }
    if (!sidebarOpen) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "pointerdown") dismissingSidebarClick.current = true;
    setSidebarPinned(false);
    setSidebarPreview(false);
  };
  const navigate = (to) => {
    setSidebarPinned(false);
    setSidebarPreview(false);
    go(to);
  };
  return (
    <div className={`portal ${sidebarOpen ? "sidebar-open" : ""}`}>
      <header className="topbar">
        <button
          type="button"
          className="collapse-button"
          aria-expanded={sidebarOpen}
          aria-controls="admin-navigation"
          aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
          onClick={() => {
            setSidebarPinned(!sidebarOpen);
            setSidebarPreview(false);
          }}
        >
          <span className="menu-icon" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="sr-only">
            {sidebarOpen ? "Close navigation" : "Open navigation"}
          </span>
        </button>
        <button
          type="button"
          className="topbar-brand"
          title={requestOnly ? "Credential requests" : "Dashboard"}
          onClick={() =>
            navigate(requestOnly ? "/admin/password-resets" : "/admin")
          }
        >
          <Brand compact light />
        </button>
        {!requestOnly && (
          <div className="topbar-academic-period" aria-live="polite">
            <AppIcon name="calendar_month" size={20} />
            <span>
              <small>ACTIVE ACADEMIC PERIOD</small>
              <b>
                {activePeriod
                  ? `${activePeriod.schoolYear} · ${activePeriod.semester}`
                  : "No active period"}
              </b>
            </span>
          </div>
        )}
      </header>
      <aside
        className="sidebar"
        aria-label="Administrator navigation"
        onPointerEnter={(event) => {
          if (
            event.pointerType !== "touch" &&
            window.matchMedia("(min-width: 901px)").matches
          )
            setSidebarPreview(true);
        }}
        onPointerLeave={() => setSidebarPreview(false)}
        onFocusCapture={() => {
          if (window.matchMedia("(min-width: 901px)").matches)
            setSidebarPreview(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setSidebarPreview(false);
        }}
      >
        <nav id="admin-navigation">
          <p className="nav-section">OPERATIONS</p>
          {navGroups
            .filter(([, to]) => !requestOnly || to === "/admin/password-resets")
            .map(([group, to, label, icon], index) => (
              <React.Fragment key={to}>
                {[1, 6, 10].includes(index) && (
                  <p className="nav-section">
                    {index === 1
                      ? "RECORDS & DISPENSING"
                      : index === 6
                        ? "MONITORING"
                        : "ADMINISTRATION"}
                  </p>
                )}
                <button
                  type="button"
                  title={label}
                  className={
                    path === to || (to !== "/admin" && path.startsWith(to))
                      ? "nav-link active"
                      : "nav-link"
                  }
                  onClick={() => navigate(to)}
                >
                  <span className="nav-icon">
                    <AppIcon name={icon} size={20} />
                  </span>
                  <span className="nav-label">{label}</span>
                  {to === "/admin/password-resets" &&
                    pendingRequestCount > 0 && (
                      <span
                        className="nav-notification-badge"
                        aria-label={`${pendingRequestCount} pending requests`}
                      >
                        {pendingRequestCount > 99 ? "99+" : pendingRequestCount}
                      </span>
                    )}
                </button>
              </React.Fragment>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <span
            className="admin-chip-compact"
            title={`${admin?.fullName || admin?.username || "Administrator"} — ${admin?.role || "Administrator"}`}
            aria-label={`${admin?.fullName || admin?.username || "Administrator"}, ${admin?.role || "Administrator"}`}
          >
            <AppIcon name="admin_panel_settings" size={21} />
          </span>
          <div className="admin-chip">
            <b>{admin?.fullName || admin?.username || "Administrator"}</b>
            <small>{admin?.role || "Administrator"}</small>
          </div>
          <button
            type="button"
            className="nav-link"
            title="Student kiosk"
            onClick={() => navigate("/")}
          >
            <span className="nav-icon">
              <AppIcon name="desktop_windows" size={20} />
            </span>
            <span className="nav-label">Student kiosk</span>
          </button>
          <button
            type="button"
            className="nav-link"
            title="Sign out"
            onClick={onLogout}
          >
            <span className="nav-icon">
              <AppIcon name="logout" size={20} />
            </span>
            <span className="nav-label">Sign out</span>
          </button>
        </div>
      </aside>
      <section className="portal-content">
        <main
          className="portal-main"
          onPointerDownCapture={closeSidebarFromMain}
          onClickCapture={closeSidebarFromMain}
        >
          {children}
        </main>
      </section>
    </div>
  );
}
function PageHeader({ title, description, actions }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">ADMINISTRATION</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="header-actions">{actions}</div>
    </header>
  );
}
function AdminLogin({ onLogin, notice = "" }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  useEffect(() => {
    let active = true;
    request("/auth/setup-status")
      .then(({ required }) => active && setSetupRequired(Boolean(required)))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const session = await request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      onLogin(session.accessToken);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="admin-login-page">
      <KioskHeader
        mode="Administration"
        subtitle="Credentials Dispenser Administration"
      />
      <main className="admin-login">
        <section className="admin-login-card">
          <aside className="admin-login-intro">
            <Brand light />
            <div>
              <span className="mark">MIS ADMINISTRATION</span>
              <h1>Manage credentials with confidence.</h1>
              <p>
                A secure workspace for student accounts, WiFi vouchers, imports,
                and kiosk operations.
              </p>
            </div>
            <small>Authorized personnel only</small>
          </aside>
          <section className="admin-panel">
            <span className="mark">ADMINISTRATOR SIGN-IN</span>
            <h2>Welcome back</h2>
            <p>Use your institutional administrator account to continue.</p>
            <form onSubmit={submit}>
              <Field
                label="Institutional email"
                type="email"
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
              />
              <Field
                label="Password"
                type="password"
                value={form.password}
                onChange={(v) => setForm({ ...form, password: v })}
                revealPassword
                passwordVisible={passwordVisible}
                onPasswordVisibilityChange={setPasswordVisible}
              />
              {(error || notice) && (
                <p className="error" role="alert">
                  {error || notice}
                </p>
              )}
              <button className="btn primary wide">Sign in</button>
            </form>
            {setupRequired && (
              <button className="link-button" onClick={() => go("/setup")}>
                First-time setup
              </button>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
function Dashboard({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const next = await request("/admin/dashboard", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (active) {
          setData(next);
          setError("");
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        loading = false;
      }
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(interval);
      removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [token, refreshVersion]);
  const credentials = Array.isArray(data?.credentials) ? data.credentials : [];
  const activity = Array.isArray(data?.recentActivity)
    ? data.recentActivity
    : [];
  const vouchers = data?.vouchers || { available: 0, assigned: 0 };
  const kiosks = data?.kiosks || { online: 0, total: 0 };
  const voucherTotal = vouchers.total || vouchers.available + vouchers.assigned;
  const studentsWithoutVoucher = Number(vouchers.studentsWithoutVoucher || 0);
  const voucherBalance = vouchers.available - studentsWithoutVoucher;
  const voucherComparison = !data?.academicPeriod
    ? {
        tone: "neutral",
        title: "No current academic period",
        detail: "Activate an academic period to compare students and stock.",
      }
    : !data.activeStudents
      ? {
          tone: "neutral",
          title: "No active students",
          detail: "No students need vouchers in the current academic period.",
        }
      : !studentsWithoutVoucher
        ? {
            tone: "green",
            title: "All students have vouchers",
            detail: `${vouchers.available} voucher${vouchers.available === 1 ? " remains" : "s remain"} available.`,
          }
        : voucherBalance < 0
          ? {
              tone: "danger",
              title: `Short by ${-voucherBalance} voucher${voucherBalance === -1 ? "" : "s"}`,
              detail:
                "More stock is needed to cover students without vouchers.",
            }
          : {
              tone: "green",
              title: voucherBalance
                ? `${voucherBalance} extra voucher${voucherBalance === 1 ? "" : "s"}`
                : "Enough vouchers for every student",
              detail:
                "Available stock covers all students still needing a voucher.",
            };
  const assignedRate = voucherTotal
    ? Math.round((vouchers.assigned / voucherTotal) * 100)
    : 0;
  const accountTotal = credentials.reduce(
    (total, account) => total + Number(account.total || 0),
    0,
  );
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Operational overview for the NDMU Credentials Dispenser."
        actions={
          <Button
            variant="secondary"
            onClick={() => setRefreshVersion((version) => version + 1)}
          >
            Refresh
          </Button>
        }
      />
      {error && <p className="error">{error}</p>}
      {!data ? (
        <p>Loading dashboard...</p>
      ) : (
        <>
          <section className="dashboard-hero panel">
            <div>
              <p className="eyebrow">SYSTEM STATUS</p>
              <h2>
                {data.pendingRequests
                  ? `${data.pendingRequests} request${data.pendingRequests === 1 ? "" : "s"} need attention`
                  : "Everything is up to date"}
              </h2>
              <p>
                {data.pendingRequests
                  ? "Review incoming account, password, and voucher requests before they affect student access."
                  : "No pending credential requests. Kiosk activity and stock are being monitored below."}
              </p>
            </div>
            <div className="dashboard-hero-actions">
              {data.pendingRequests > 0 && (
                <Button onClick={() => go("/admin/password-resets")}>
                  <AppIcon name="assignment" /> Review requests
                </Button>
              )}
              <Button variant="secondary" onClick={() => go("/admin/imports")}>
                <AppIcon name="upload_file" /> Import records
              </Button>
            </div>
          </section>
          <section className="dashboard-metric-grid">
            <Metric
              icon="students"
              label="Active students"
              value={data.activeStudents || 0}
              note={`${data.activeCourses} active courses`}
              tone="green"
            />
            <Metric
              icon="confirmation_number"
              label="Available vouchers"
              value={vouchers.available}
              note={`${voucherTotal} in active stock`}
              tone="gold"
            />
            <Metric
              icon="requests"
              label="Pending requests"
              value={data.pendingRequests || 0}
              note={
                data.pendingRequests
                  ? "Needs administrator review"
                  : "Request queue is clear"
              }
              tone={data.pendingRequests ? "danger" : "green"}
            />
            <Metric
              icon="kiosk"
              label="Kiosks online"
              value={`${kiosks.online} / ${kiosks.total}`}
              note={
                kiosks.online === kiosks.total
                  ? "All registered kiosks reachable"
                  : "Check kiosk connection status"
              }
              tone="blue"
            />
          </section>
          <section className="dashboard-layout">
            <article className="panel dashboard-stock-panel">
              <header>
                <div>
                  <p className="eyebrow">WIFI VOUCHERS</p>
                  <h2>Voucher stock</h2>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => go("/admin/vouchers")}
                >
                  Manage
                </Button>
              </header>
              <div className="voucher-stock-comparison">
                <div className="voucher-stock-figure">
                  <strong>{vouchers.available}</strong>
                  <span>Available vouchers</span>
                </div>
                <div className="voucher-stock-figure">
                  <strong>{studentsWithoutVoucher}</strong>
                  <span>Students without vouchers</span>
                </div>
              </div>
              <div
                className={`voucher-stock-status ${voucherComparison.tone}`}
                role="status"
              >
                <AppIcon
                  name={
                    voucherComparison.tone === "danger"
                      ? "warning"
                      : voucherComparison.tone === "green"
                        ? "check_circle"
                        : "info"
                  }
                />
                <div>
                  <b>{voucherComparison.title}</b>
                  <span>{voucherComparison.detail}</span>
                </div>
              </div>
              <div className="voucher-stock-bar">
                <i style={{ width: `${assignedRate}%` }} />
              </div>
              <div className="voucher-stock-labels">
                <span>{vouchers.assigned} assigned</span>
                <span>{assignedRate}% in use</span>
              </div>
              <p className="dashboard-panel-note">
                Counts cover active students and vouchers in the current
                academic period. Released and inactive vouchers are excluded
                from available stock.
              </p>
            </article>
            <article className="panel dashboard-coverage-panel">
              <header>
                <div>
                  <p className="eyebrow">ACCOUNT COVERAGE</p>
                  <h2>Credential accounts</h2>
                </div>
                <span className="coverage-total">{accountTotal} linked</span>
              </header>
              {credentials.length ? (
                credentials.map((c) => (
                  <div className="coverage-row" key={c.credential_type}>
                    <span>
                      <AppIcon name="key" size={17} />
                      {c.credential_type}
                    </span>
                    <b>{c.total}</b>
                  </div>
                ))
              ) : (
                <Empty
                  title="No credential records"
                  detail="Import account records to view coverage."
                />
              )}
            </article>
            <article className="panel dashboard-activity-panel">
              <header>
                <div>
                  <p className="eyebrow">LIVE ACTIVITY</p>
                  <h2>Recent credential reveals</h2>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => go("/admin/transactions")}
                >
                  View all
                </Button>
              </header>
              {activity.length ? (
                activity.map((a, i) => (
                  <div className="dashboard-activity-row" key={i}>
                    <span className="activity-icon">
                      <AppIcon name="visibility" size={18} />
                    </span>
                    <span>
                      <b>
                        {a.first_name
                          ? [a.first_name, a.middle_name, a.last_name]
                              .filter(Boolean)
                              .join(" ")
                          : "Student credentials viewed"}
                      </b>
                      <small>
                        {a.student_id || "Unknown student"}
                        {a.kiosk_code ? ` · ${a.kiosk_code}` : ""}
                      </small>
                    </span>
                    <time>{new Date(a.created_at).toLocaleString()}</time>
                  </div>
                ))
              ) : (
                <Empty
                  title="No activity yet"
                  detail="Credential reveals appear here after a student confirms Show All."
                />
              )}
            </article>
          </section>
        </>
      )}
    </>
  );
}
function Metric({ icon, label, value, note, tone = "green" }) {
  return (
    <article className={`metric dashboard-metric ${tone}`}>
      <span className="dashboard-metric-icon">
        <AppIcon name={icon} size={22} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

function LegacyStudentFormModal({ token, onClose, onSaved }) {
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState({
    studentId: "",
    kumosoftId: "",
    firstName: "",
    middleName: "",
    lastName: "",
    birthDate: "",
    courseId: "",
    yearLevel: "",
    isActive: true,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    request("/admin/courses", { headers: { Authorization: `Bearer ${token}` } })
      .then(setCourses)
      .catch((e) => setError(e.message));
  }, []);
  const update = (key, value) => setForm({ ...form, [key]: value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request("/admin/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="student-modal add-student-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">STUDENT MANAGEMENT</p>
            <h2>Add student</h2>
            <p>
              Create the student record before importing or assigning accounts.
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>
        <form className="student-form" onSubmit={submit}>
          <div className="form-section">
            <h3>Student identity</h3>
            <div className="form-grid">
              <Field
                label="School ID"
                value={form.studentId}
                onChange={(v) => update("studentId", v)}
              />
              <Field
                label="Kumosoft ID (optional)"
                value={form.kumosoftId}
                onChange={(v) => update("kumosoftId", v)}
              />
              <Field
                label="Last name"
                value={form.lastName}
                onChange={(v) => update("lastName", v)}
              />
              <Field
                label="First name"
                value={form.firstName}
                onChange={(v) => update("firstName", v)}
              />
              <Field
                label="Middle name (optional)"
                value={form.middleName}
                onChange={(v) => update("middleName", v)}
              />
              <Field
                label="Birthday"
                type="date"
                value={form.birthDate}
                onChange={(v) => update("birthDate", v)}
              />
            </div>
          </div>
          <div className="form-section">
            <h3>Enrollment</h3>
            <div className="form-grid">
              <label className="field">
                <span>Course</span>
                <select
                  required
                  value={form.courseId}
                  onChange={(e) => update("courseId", e.target.value)}
                >
                  <option value="">Select course</option>
                  {courses.map((course) => (
                    <option value={course.id} key={course.id}>
                      {course.code} - {course.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Year level</span>
                <select
                  value={form.yearLevel}
                  onChange={(e) => update("yearLevel", e.target.value)}
                >
                  <option value="">Not specified</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((year) => (
                    <option value={year} key={year}>
                      Year {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => update("isActive", e.target.checked)}
                />
                <span>
                  <b>Active student</b>
                  <small>Student can verify at the kiosk.</small>
                </span>
              </label>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <footer>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <button disabled={saving} className="btn primary">
              {saving ? "Saving..." : "Save student"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function LegacyStudentsPageV3({ token }) {
  const [result, setResult] = useState({ rows: [], total: 0 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ page: "1", limit: "50", status });
    if (search.trim()) query.set("search", search.trim());
    request(`/admin/students?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [status]);
  const open = (id) =>
    request(`/admin/students/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setSelected)
      .catch((e) => setError(e.message));
  const saved = () => {
    setAdding(false);
    load();
  };
  return (
    <>
      <PageHeader
        title="Students"
        description="Select a student to view their profile and linked credentials."
        actions={
          <>
            <Button variant="secondary" onClick={() => go("/admin/imports")}>
              Import students
            </Button>
            <Button onClick={() => setAdding(true)}>Add student</Button>
          </>
        }
      />
      <section className="student-summary">
        <article>
          <span>Total records</span>
          <strong>{result.total}</strong>
        </article>
        <article>
          <span>Available account types</span>
          <strong>4</strong>
        </article>
        <article>
          <span>Verification fields</span>
          <strong>4</strong>
          <small>ID, surname, birthday, course</small>
        </article>
      </section>
      <section className="panel student-panel">
        <form
          className="student-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <div className="search-wrap">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student ID, Kumosoft ID, or name"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <button className="btn secondary">Search</button>
        </form>
        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="loading-row">Loading student records...</p>
        ) : result.rows.length ? (
          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>School ID</th>
                  <th>Course</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((s) => (
                  <tr
                    key={s.id}
                    className="student-clickable"
                    onClick={() => open(s.id)}
                  >
                    <td>
                      <b>
                        {[s.first_name, s.middle_name, s.last_name]
                          .filter(Boolean)
                          .join(" ")}
                      </b>
                      <small>{s.kumosoft_id || "No Kumosoft ID"}</small>
                    </td>
                    <td>{s.student_id}</td>
                    <td>
                      <b>{s.course_code}</b>
                      <small>{s.course_name}</small>
                    </td>
                    <td>{s.year_level || "-"}</td>
                    <td>
                      <Status tone={s.is_active ? "green" : "gold"}>
                        {s.is_active ? "Active" : "Inactive"}
                      </Status>
                    </td>
                    <td>
                      <button
                        className="row-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(s.id);
                        }}
                      >
                        View profile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No students found"
            detail="Import student records or add the first student manually."
            action={
              <Button onClick={() => setAdding(true)}>Add student</Button>
            }
          />
        )}
        <footer className="table-footer">
          <span>
            Showing {result.rows.length} of {result.total} students
          </span>
        </footer>
      </section>
      {adding && (
        <StudentFormModal
          token={token}
          onClose={() => setAdding(false)}
          onSaved={saved}
        />
      )}
      <StudentProfileModal
        record={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
function LegacyStudentFormModalV2({ token, onClose, onSaved }) {
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    studentId: "",
    kumosoftId: "",
    firstName: "",
    middleName: "",
    lastName: "",
    birthDate: "",
    courseId: "",
    isActive: true,
    satpPassword: "",
    schoologyPassword: "",
    kumosoftPassword: "",
    emailAddress: "",
    emailPassword: "",
  });
  useEffect(() => {
    request("/admin/courses", { headers: { Authorization: `Bearer ${token}` } })
      .then(setCourses)
      .catch((e) => setError(e.message));
  }, []);
  const update = (key, value) => setForm({ ...form, [key]: value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request("/admin/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="student-modal add-student-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">STUDENT MANAGEMENT</p>
            <h2>Add student</h2>
            <p>Account credentials are optional and can be updated later.</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>
        <form className="student-form" onSubmit={submit}>
          <div className="form-section">
            <h3>Student information</h3>
            <div className="form-grid">
              <Field
                label="School ID"
                value={form.studentId}
                onChange={(v) => update("studentId", v)}
              />
              <Field
                label="Kumosoft ID (optional)"
                value={form.kumosoftId}
                onChange={(v) => update("kumosoftId", v)}
              />
              <Field
                label="Last name"
                value={form.lastName}
                onChange={(v) => update("lastName", v)}
              />
              <Field
                label="First name"
                value={form.firstName}
                onChange={(v) => update("firstName", v)}
              />
              <Field
                label="Middle name (optional)"
                value={form.middleName}
                onChange={(v) => update("middleName", v)}
              />
              <Field
                label="Birthday"
                type="date"
                value={form.birthDate}
                onChange={(v) => update("birthDate", v)}
              />
              <label className="field">
                <span>Course</span>
                <select
                  required
                  value={form.courseId}
                  onChange={(e) => update("courseId", e.target.value)}
                >
                  <option value="">Select course</option>
                  {courses.map((course) => (
                    <option value={course.id} key={course.id}>
                      {course.code} - {course.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => update("isActive", e.target.checked)}
                />
                <span>
                  <b>Active student</b>
                  <small>Student can verify at the kiosk.</small>
                </span>
              </label>
            </div>
          </div>
          <div className="form-section">
            <h3>Optional account credentials</h3>
            <p className="form-note">
              SATP and Schoology use the School ID. Kumosoft uses the Kumosoft
              ID when provided.
            </p>
            <div className="form-grid">
              <Field
                label="SATP password (optional)"
                type="password"
                value={form.satpPassword}
                onChange={(v) => update("satpPassword", v)}
              />
              <Field
                label="Schoology password (optional)"
                type="password"
                value={form.schoologyPassword}
                onChange={(v) => update("schoologyPassword", v)}
              />
              <Field
                label="Kumosoft password (optional)"
                type="password"
                value={form.kumosoftPassword}
                onChange={(v) => update("kumosoftPassword", v)}
              />
              <Field
                label="Institutional email (optional)"
                type="email"
                value={form.emailAddress}
                onChange={(v) => update("emailAddress", v)}
              />
              <Field
                label="Email password (optional)"
                type="password"
                value={form.emailPassword}
                onChange={(v) => update("emailPassword", v)}
              />
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <footer>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <button disabled={saving} className="btn primary">
              {saving ? "Saving..." : "Save student"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function LegacyStudentFormModalV3({ token, onClose, onSaved }) {
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    studentId: "",
    kumosoftId: "",
    firstName: "",
    middleName: "",
    lastName: "",
    birthDate: "",
    courseId: "",
    isActive: true,
    satpPassword: "",
    schoologyPassword: "",
    kumosoftPassword: "",
    emailAddress: "",
    emailPassword: "",
  });
  useEffect(() => {
    request("/admin/courses", { headers: { Authorization: `Bearer ${token}` } })
      .then(setCourses)
      .catch((e) => setError(e.message));
  }, []);
  const update = (key, value) => setForm({ ...form, [key]: value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request("/admin/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="student-modal add-student-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">STUDENT MANAGEMENT</p>
            <h2>Add student</h2>
            <p>Account credentials are optional and can be updated later.</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>
        <form className="student-form" onSubmit={submit}>
          <div className="form-section">
            <h3>Student information</h3>
            <div className="form-grid">
              <Field
                label="School ID"
                value={form.studentId}
                onChange={(v) => update("studentId", v)}
              />
              <Field
                label="Kumosoft ID (optional)"
                value={form.kumosoftId}
                onChange={(v) => update("kumosoftId", v)}
              />
              <Field
                label="Last name"
                value={form.lastName}
                onChange={(v) => update("lastName", v)}
              />
              <Field
                label="First name"
                value={form.firstName}
                onChange={(v) => update("firstName", v)}
              />
              <Field
                label="Middle name (optional)"
                value={form.middleName}
                onChange={(v) => update("middleName", v)}
              />
              <Field
                label="Birthday"
                type="date"
                value={form.birthDate}
                onChange={(v) => update("birthDate", v)}
              />
              <label className="field">
                <span>Course</span>
                <select
                  required
                  value={form.courseId}
                  onChange={(e) => update("courseId", e.target.value)}
                >
                  <option value="">Select course</option>
                  {courses.map((course) => (
                    <option value={course.id} key={course.id}>
                      {course.code} - {course.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="form-section">
            <h3>Optional account credentials</h3>
            <p className="form-note">
              SATP and Schoology use the School ID. Kumosoft uses the Kumosoft
              ID when provided.
            </p>
            <div className="form-grid">
              <Field
                label="SATP password (optional)"
                type="password"
                value={form.satpPassword}
                onChange={(v) => update("satpPassword", v)}
              />
              <Field
                label="Schoology password (optional)"
                type="password"
                value={form.schoologyPassword}
                onChange={(v) => update("schoologyPassword", v)}
              />
              <Field
                label="Kumosoft password (optional)"
                type="password"
                value={form.kumosoftPassword}
                onChange={(v) => update("kumosoftPassword", v)}
              />
              <Field
                label="Institutional email (optional)"
                type="email"
                value={form.emailAddress}
                onChange={(v) => update("emailAddress", v)}
              />
              <Field
                label="Email password (optional)"
                type="password"
                value={form.emailPassword}
                onChange={(v) => update("emailPassword", v)}
              />
            </div>
          </div>
          <label className="status-toggle">
            <span>
              <b>Active student</b>
              <small>Student can verify at the kiosk.</small>
            </span>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => update("isActive", e.target.checked)}
            />
            <i aria-hidden="true" />
          </label>
          {error && <p className="error">{error}</p>}
          <footer>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <button disabled={saving} className="btn primary">
              {saving ? "Saving..." : "Save student"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function LegacyStudentFormModalV4({ token, onClose, onSaved }) {
  const [courses, setCourses] = useState([]),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState({
    studentId: "",
    kumosoftId: "",
    firstName: "",
    middleName: "",
    lastName: "",
    birthDate: "",
    courseId: "",
    isActive: true,
    satpPassword: "",
    schoologyPassword: "",
    kumosoftPassword: "",
    emailAddress: "",
    emailPassword: "",
  });
  useEffect(() => {
    request("/admin/courses", { headers: { Authorization: `Bearer ${token}` } })
      .then(setCourses)
      .catch((e) => setError(e.message));
  }, []);
  const update = (key, value) => setForm({ ...form, [key]: value });
  const save = async () => {
    setConfirm(false);
    setSaving(true);
    setError("");
    try {
      await request("/admin/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="modal-backdrop" onMouseDown={onClose}>
        <section
          className="student-modal add-student-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header>
            <div>
              <p className="eyebrow">STUDENT MANAGEMENT</p>
              <h2>Add student</h2>
              <p>Account credentials are optional and can be updated later.</p>
            </div>
            <button className="modal-close" onClick={onClose}>
              &times;
            </button>
          </header>
          <form
            className="student-form"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirm(true);
            }}
          >
            <div className="form-section">
              <h3>Student information</h3>
              <div className="form-grid">
                <Field
                  label="School ID"
                  value={form.studentId}
                  onChange={(v) => update("studentId", v)}
                />
                <Field
                  label="Kumosoft ID (optional)"
                  value={form.kumosoftId}
                  onChange={(v) => update("kumosoftId", v)}
                />
                <Field
                  label="Last name"
                  value={form.lastName}
                  onChange={(v) => update("lastName", v)}
                />
                <Field
                  label="First name"
                  value={form.firstName}
                  onChange={(v) => update("firstName", v)}
                />
                <Field
                  label="Middle name (optional)"
                  value={form.middleName}
                  onChange={(v) => update("middleName", v)}
                />
                <Field
                  label="Birthday"
                  type="date"
                  value={form.birthDate}
                  onChange={(v) => update("birthDate", v)}
                />
                <label className="field">
                  <span>Course</span>
                  <select
                    required
                    value={form.courseId}
                    onChange={(e) => update("courseId", e.target.value)}
                  >
                    <option value="">Select course</option>
                    {courses.map((course) => (
                      <option value={course.id} key={course.id}>
                        {course.code} - {course.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="form-section">
              <h3>Account credentials</h3>
              <p className="form-note">
                SATP and Schoology use the School ID. Kumosoft uses the Kumosoft
                ID when provided.
              </p>
              <div className="form-grid">
                <Field
                  label="SATP password"
                  type="text"
                  value={form.satpPassword}
                  onChange={(v) => update("satpPassword", v)}
                />
                <Field
                  label="Schoology password"
                  type="text"
                  value={form.schoologyPassword}
                  onChange={(v) => update("schoologyPassword", v)}
                />
                <Field
                  label="Kumosoft password"
                  type="text"
                  value={form.kumosoftPassword}
                  onChange={(v) => update("kumosoftPassword", v)}
                />
                <Field
                  label="Institutional email"
                  type="email"
                  value={form.emailAddress}
                  onChange={(v) => update("emailAddress", v)}
                />
                <Field
                  label="Email password"
                  type="text"
                  value={form.emailPassword}
                  onChange={(v) => update("emailPassword", v)}
                />
              </div>
            </div>
            <label className="status-toggle">
              <span>
                <b>Active student</b>
                <small>Student can verify at the kiosk.</small>
              </span>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => update("isActive", e.target.checked)}
              />
              <i aria-hidden="true" />
            </label>
            {error && <p className="error">{error}</p>}
            <footer className="modal-form-footer">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <button disabled={saving} className="btn primary">
                {saving ? "Saving..." : "Save student"}
              </button>
            </footer>
          </form>
        </section>
      </div>
      {confirm && (
        <ConfirmModal
          title="Create student record?"
          message={`Create a student record for ${form.firstName} ${form.lastName} using School ID ${form.studentId}?`}
          confirmLabel="Create student"
          onClose={() => setConfirm(false)}
          onConfirm={save}
        />
      )}
    </>
  );
}
function CourseSearchSelect({ courses, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = courses.find(
    (course) => String(course.id) === String(value),
  );
  const selectedLabel = selected ? `${selected.code} - ${selected.name}` : "";
  useEffect(() => {
    if (!open) setQuery(selectedLabel);
  }, [open, selectedLabel]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCourses = courses.filter((course) =>
    `${course.code} ${course.name}`.toLowerCase().includes(normalizedQuery),
  );
  const choose = (course) => {
    onChange(String(course.id));
    setQuery(`${course.code} - ${course.name}`);
    setOpen(false);
  };
  return (
    <label className="field course-search-field">
      <span>Course</span>
      <div className={`course-search-combobox${open ? " open" : ""}`}>
        <input
          required
          role="combobox"
          aria-expanded={open}
          aria-controls="student-course-results"
          autoComplete="off"
          value={query}
          placeholder="Search course code or name"
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              setQuery(selectedLabel);
            }, 120)
          }
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setQuery(selectedLabel);
            }
            if (event.key === "Enter" && open && filteredCourses.length) {
              event.preventDefault();
              choose(filteredCourses[0]);
            }
          }}
        />
        <span className="course-search-chevron" aria-hidden="true">
          <AppIcon name="expand_more" size={20} />
        </span>
        {open && (
          <div
            className="course-search-results"
            id="student-course-results"
            role="listbox"
          >
            {filteredCourses.length ? (
              filteredCourses.map((course) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={String(course.id) === String(value)}
                  key={course.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(course)}
                >
                  <b>{course.code}</b>
                  <span>{course.name}</span>
                </button>
              ))
            ) : (
              <p>No matching courses found.</p>
            )}
          </div>
        )}
      </div>
    </label>
  );
}
function KioskCourseSelect({ courses, value, onChange }) {
  const selected = courses.find(
    (course) => String(course.id) === String(value),
  );
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false);
  useEffect(() => {
    setQuery(selected ? `${selected.code} - ${selected.name}` : "");
  }, [value, courses]);
  const normalized = query.trim().toLowerCase();
  const filtered = courses.filter((course) =>
    `${course.code} ${course.name}`.toLowerCase().includes(normalized),
  );
  const choose = (course) => {
    onChange(String(course.id));
    setQuery(`${course.code} - ${course.name}`);
    setOpen(false);
  };
  return (
    <label className="field kiosk-course-search">
      <span>Select your course</span>
      <div className={`kiosk-course-combobox${open ? " open" : ""}`}>
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="kiosk-course-results"
          autoComplete="off"
          value={query}
          placeholder="Search course code or name..."
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && open && filtered.length) {
              event.preventDefault();
              choose(filtered[0]);
            }
          }}
        />
        <span className="kiosk-course-chevron" aria-hidden="true">
          <AppIcon name="expand_more" size={20} />
        </span>
        {open && (
          <div
            className="kiosk-course-results"
            id="kiosk-course-results"
            role="listbox"
          >
            {filtered.length ? (
              filtered.map((course) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={String(course.id) === String(value)}
                  key={course.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(course)}
                >
                  <b>{course.code}</b>
                  <span>{course.name}</span>
                </button>
              ))
            ) : (
              <p>No matching courses found.</p>
            )}
          </div>
        )}
      </div>
    </label>
  );
}
function StudentFormModal({ token, onClose, onSaved }) {
  const [courses, setCourses] = useState([]),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState({
    studentId: "",
    kumosoftId: "",
    firstName: "",
    middleName: "",
    lastName: "",
    birthDate: "",
    courseId: "",
    isActive: true,
    satpPassword: "",
    schoologyPassword: "",
    kumosoftPassword: "",
    emailAddress: "",
    emailPassword: "",
  });
  useEffect(() => {
    request("/admin/courses", { headers: { Authorization: `Bearer ${token}` } })
      .then(setCourses)
      .catch((e) => setError(e.message));
  }, []);
  const update = (key, value) => setForm({ ...form, [key]: value });
  const save = async () => {
    setConfirm(false);
    setSaving(true);
    try {
      await request("/admin/students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="modal-backdrop" onMouseDown={onClose}>
        <section
          className="student-modal edit-student-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header>
            <div>
              <p className="eyebrow">STUDENT MANAGEMENT</p>
              <h2>Add student</h2>
              <p>Account credentials are optional and can be updated later.</p>
            </div>
            <button className="modal-close" onClick={onClose}>
              &times;
            </button>
          </header>
          <form
            className="student-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.courseId)
                return setError("Select a course from the list.");
              setConfirm(true);
            }}
          >
            <div className="form-section">
              <h3>Student information</h3>
              <div className="form-grid">
                <Field
                  label="School ID"
                  value={form.studentId}
                  onChange={(v) => update("studentId", v)}
                />
                <Field
                  label="Kumosoft ID (optional)"
                  value={form.kumosoftId}
                  onChange={(v) => update("kumosoftId", v)}
                />
                <Field
                  label="Last name"
                  value={form.lastName}
                  onChange={(v) => update("lastName", v)}
                />
                <Field
                  label="First name"
                  value={form.firstName}
                  onChange={(v) => update("firstName", v)}
                />
                <Field
                  label="Middle name (optional)"
                  value={form.middleName}
                  onChange={(v) => update("middleName", v)}
                />
                <Field
                  label="Birthday"
                  type="date"
                  value={form.birthDate}
                  onChange={(v) => update("birthDate", v)}
                />
                <CourseSearchSelect
                  courses={courses}
                  value={form.courseId}
                  onChange={(v) => update("courseId", v)}
                />
              </div>
            </div>
            <div className="form-section">
              <h3>Optional account credentials</h3>
              <p className="form-note">
                SATP and Schoology use the School ID. Kumosoft uses the Kumosoft
                ID when provided.
              </p>
              <div className="form-grid">
                <Field
                  label="SATP password (optional)"
                  type="password"
                  value={form.satpPassword}
                  onChange={(v) => update("satpPassword", v)}
                />
                <Field
                  label="Schoology password (optional)"
                  type="password"
                  value={form.schoologyPassword}
                  onChange={(v) => update("schoologyPassword", v)}
                />
                <Field
                  label="Kumosoft password (optional)"
                  type="password"
                  value={form.kumosoftPassword}
                  onChange={(v) => update("kumosoftPassword", v)}
                />
                <Field
                  label="Institutional email (optional)"
                  type="email"
                  value={form.emailAddress}
                  onChange={(v) => update("emailAddress", v)}
                />
                <Field
                  label="Email password (optional)"
                  type="password"
                  value={form.emailPassword}
                  onChange={(v) => update("emailPassword", v)}
                />
              </div>
            </div>
            <label className="status-toggle">
              <span>
                <b>Active student</b>
                <small>Student can verify at the kiosk.</small>
              </span>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => update("isActive", e.target.checked)}
              />
              <i />
            </label>
            {error && <p className="error">{error}</p>}
            <footer className="modal-form-footer">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <button disabled={saving} className="btn primary">
                {saving ? "Saving..." : "Save student"}
              </button>
            </footer>
          </form>
        </section>
      </div>
      {confirm && (
        <ConfirmModal
          title="Create student record?"
          message={`Create a student record for ${form.firstName} ${form.lastName} using School ID ${form.studentId}?`}
          confirmLabel="Create student"
          onClose={() => setConfirm(false)}
          onConfirm={save}
        />
      )}
    </>
  );
}
function LegacyCoursesPage({ token }) {
  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState({ code: "", name: "" });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    request("/admin/course-records", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setCourses)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await request("/admin/course-records", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      setForm({ code: "", name: "" });
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      <PageHeader
        title="Courses"
        description="Manage course master data used when students are verified at the kiosk."
        actions={<Button onClick={() => setAdding(true)}>Add course</Button>}
      />
      <section className="student-summary">
        <article>
          <span>Total courses</span>
          <strong>{courses.length}</strong>
        </article>
        <article>
          <span>Active courses</span>
          <strong>{courses.filter((c) => c.is_active).length}</strong>
        </article>
        <article>
          <span>Linked students</span>
          <strong>
            {courses.reduce((total, c) => total + Number(c.student_count), 0)}
          </strong>
          <small>Students are linked through this course table.</small>
        </article>
      </section>
      <section className="panel student-panel">
        <div className="course-intro">
          Courses created here appear automatically in the Add Student course
          selector.
        </div>
        {error && <p className="error">{error}</p>}
        {courses.length ? (
          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Course code</th>
                  <th>Course name</th>
                  <th>Linked students</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <b>{course.code}</b>
                    </td>
                    <td>{course.name}</td>
                    <td>{course.student_count}</td>
                    <td>
                      <Status tone={course.is_active ? "green" : "gold"}>
                        {course.is_active ? "Active" : "Inactive"}
                      </Status>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No courses yet"
            detail="Add a course before creating student records."
            action={<Button onClick={() => setAdding(true)}>Add course</Button>}
          />
        )}
      </section>
      {adding && (
        <div className="modal-backdrop" onMouseDown={() => setAdding(false)}>
          <section
            className="course-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">COURSE MASTER DATA</p>
                <h2>Add course</h2>
                <p>
                  This course will be available to students immediately after
                  saving.
                </p>
              </div>
              <button className="modal-close" onClick={() => setAdding(false)}>
                ×
              </button>
            </header>
            <form onSubmit={submit}>
              <Field
                label="Course code"
                value={form.code}
                onChange={(v) => setForm({ ...form, code: v })}
              />
              <Field
                label="Course name"
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
              />
              <footer>
                <Button variant="secondary" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <button className="btn primary">Save course</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
function LegacyCourseImportModal({ token, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!file) return setError("Choose a CSV or XLSX file.");
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await adminFetch("/admin/course-records/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Course import failed.");
      setResult(data);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="course-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">COURSE IMPORT</p>
            <h2>Import courses</h2>
            <p>
              Use a CSV or XLSX file with <b>CourseCode</b> and{" "}
              <b>CourseName</b> columns.
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>
        {result ? (
          <div className="import-result">
            <strong>Import complete</strong>
            <p>
              {result.inserted} added · {result.skipped} already existed ·{" "}
              {result.invalid} invalid
            </p>
            {result.errors.slice(0, 5).map((item) => (
              <small key={item.row}>
                Row {item.row}: {item.message}
              </small>
            ))}
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="file-picker">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files[0] || null)}
              />
              <span>{file ? file.name : "Choose CSV or XLSX file"}</span>
            </label>
            {error && <p className="error">{error}</p>}
            <footer>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <button disabled={uploading} className="btn primary">
                {uploading ? "Importing..." : "Import courses"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
function LegacyCourseImportModalV2({ token, onClose, onImported }) {
  const [file, setFile] = useState(null),
    [error, setError] = useState(""),
    [result, setResult] = useState(null),
    [uploading, setUploading] = useState(false);
  const downloadTemplate = () => {
    const blob = new Blob(
      [
        "\uFEFFCourseCode,CourseName\nBSIT,Bachelor of Science in Information Technology\n",
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "ndmu-course-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!file) return setError("Choose a CSV or Excel file first.");
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await adminFetch("/admin/course-records/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Course import failed.");
      setResult(data);
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };
  return <div />;
}
function LegacyCoursesPageV3({ token }) {
  return <div />;
}
function CourseImportModal({ token, onClose, onImported, onToast }) {
  return (
    <ImportHubModal
      type={importTypes.find((type) => type.id === "courses")}
      token={token}
      onClose={onClose}
      onComplete={(message) => {
        onImported();
        onToast?.(message);
      }}
    />
  );
}
function LegacyCoursesPageV4({ token }) {
  const [courses, setCourses] = useState([]),
    [importing, setImporting] = useState(false),
    [editor, setEditor] = useState(null),
    [form, setForm] = useState({ code: "", name: "" }),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [toast, setToast] = useState("");
  const perPage = 10;
  const load = () =>
    request("/admin/course-records", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => {
        setCourses(data);
        setPage((current) =>
          Math.min(current, Math.max(1, Math.ceil(data.length / perPage))),
        );
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const save = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await request(
        editor ? `/admin/course-records/${editor.id}` : "/admin/course-records",
        {
          method: editor ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        },
      );
      setEditor(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const totalPages = Math.max(1, Math.ceil(courses.length / perPage)),
    visible = courses.slice((page - 1) * perPage, page * perPage),
    openNew = () => {
      setForm({ code: "", name: "" });
      setEditor({});
    },
    openEdit = (course) => {
      setForm({ code: course.code, name: course.name });
      setEditor(course);
    };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <>
      <PageHeader
        title="Courses"
        description="Manage course master data used when students are verified at the kiosk."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import courses
            </Button>
            <Button onClick={openNew}>Add course</Button>
          </>
        }
      />
      <section className="student-summary">
        <article>
          <span>Total courses</span>
          <strong>{courses.length}</strong>
        </article>
        <article>
          <span>Active courses</span>
          <strong>{courses.filter((c) => c.is_active).length}</strong>
        </article>
        <article>
          <span>Linked students</span>
          <strong>
            {courses.reduce((total, c) => total + Number(c.student_count), 0)}
          </strong>
        </article>
      </section>
      <section className="panel student-panel">
        <div className="course-intro">
          Courses here appear automatically in the Add Student course selector.
        </div>
        {error && <p className="error">{error}</p>}
        {courses.length ? (
          <>
            <div className="student-table-wrap">
              <table className="student-table">
                <thead>
                  <tr>
                    <th>Course code</th>
                    <th>Course name</th>
                    <th>Linked students</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((course) => (
                    <tr key={course.id}>
                      <td>
                        <b>{course.code}</b>
                      </td>
                      <td>{course.name}</td>
                      <td>{course.student_count}</td>
                      <td>
                        <Status tone={course.is_active ? "green" : "gold"}>
                          {course.is_active ? "Active" : "Inactive"}
                        </Status>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => openEdit(course)}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>
                Showing {(page - 1) * perPage + 1}–
                {Math.min(page * perPage, courses.length)} of {courses.length}
              </span>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <b>
                  {page} / {totalPages}
                </b>
                <Button
                  variant="secondary"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            title="No courses yet"
            detail="Add a course or import a course spreadsheet."
            action={
              <Button onClick={() => setImporting(true)}>Import courses</Button>
            }
          />
        )}
      </section>
      {editor && (
        <div className="modal-backdrop" onMouseDown={() => setEditor(null)}>
          <section
            className="course-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">COURSE MASTER DATA</p>
                <h2>{editor.id ? "Edit course" : "Add course"}</h2>
                <p>Courses are available immediately after saving.</p>
              </div>
              <button className="modal-close" onClick={() => setEditor(null)}>
                &times;
              </button>
            </header>
            <form onSubmit={save}>
              <Field
                label="Course code"
                value={form.code}
                onChange={(v) => setForm({ ...form, code: v })}
              />
              <Field
                label="Course name"
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
              />
              <footer>
                <Button variant="secondary" onClick={() => setEditor(null)}>
                  Cancel
                </Button>
                <button className="btn primary">Save course</button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {importing && (
        <CourseImportModal
          token={token}
          onClose={() => setImporting(false)}
          onImported={load}
        />
      )}
    </>
  );
}
function LegacyCoursesPageV5({ token }) {
  const [courses, setCourses] = useState([]),
    [importing, setImporting] = useState(false),
    [editor, setEditor] = useState(null),
    [form, setForm] = useState({ code: "", name: "" }),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [toast, setToast] = useState("");
  const perPage = 10;
  const load = () =>
    request("/admin/course-records", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => setCourses(data))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const save = async (e) => {
    e.preventDefault();
    try {
      await request(
        editor?.id
          ? `/admin/course-records/${editor.id}`
          : "/admin/course-records",
        {
          method: editor?.id ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        },
      );
      setEditor(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const totalPages = Math.max(1, Math.ceil(courses.length / perPage)),
    rows = courses.slice((page - 1) * perPage, page * perPage);
  const edit = (course) => {
    setForm(
      course
        ? { code: course.code, name: course.name }
        : { code: "", name: "" },
    );
    setEditor(course || {});
  };
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Courses"
        description="Manage course master data used when students are verified at the kiosk."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import courses
            </Button>
            <Button onClick={() => edit(null)}>Add course</Button>
          </>
        }
      />
      <section className="student-summary">
        <article>
          <span>Total courses</span>
          <strong>{courses.length}</strong>
        </article>
        <article>
          <span>Active courses</span>
          <strong>{courses.filter((course) => course.is_active).length}</strong>
        </article>
        <article>
          <span>Linked students</span>
          <strong>
            {courses.reduce(
              (total, course) => total + Number(course.student_count),
              0,
            )}
          </strong>
        </article>
      </section>
      <section className="panel student-panel">
        <div className="course-intro">
          Courses here appear automatically in the Add Student course selector.
        </div>
        {error && <p className="error">{error}</p>}
        {courses.length ? (
          <>
            <div className="student-table-wrap">
              <table className="student-table">
                <thead>
                  <tr>
                    <th>Course code</th>
                    <th>Course name</th>
                    <th>Linked students</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((course) => (
                    <tr key={course.id}>
                      <td>
                        <b>{course.code}</b>
                      </td>
                      <td>{course.name}</td>
                      <td>{course.student_count}</td>
                      <td>
                        <Status tone={course.is_active ? "green" : "gold"}>
                          {course.is_active ? "Active" : "Inactive"}
                        </Status>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => edit(course)}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>
                Page {page} of {totalPages}
              </span>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            title="No courses yet"
            detail="Add a course or import a course spreadsheet."
            action={
              <Button onClick={() => setImporting(true)}>Import courses</Button>
            }
          />
        )}
      </section>
      {editor && (
        <div className="modal-backdrop" onMouseDown={() => setEditor(null)}>
          <section
            className="course-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">COURSE MASTER DATA</p>
                <h2>{editor.id ? "Edit course" : "Add course"}</h2>
                <p>Courses are available immediately after saving.</p>
              </div>
              <button className="modal-close" onClick={() => setEditor(null)}>
                &times;
              </button>
            </header>
            <form onSubmit={save}>
              <Field
                label="Course code"
                value={form.code}
                onChange={(value) => setForm({ ...form, code: value })}
              />
              <Field
                label="Course name"
                value={form.name}
                onChange={(value) => setForm({ ...form, name: value })}
              />
              <footer>
                <Button variant="secondary" onClick={() => setEditor(null)}>
                  Cancel
                </Button>
                <button className="btn primary">Save course</button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {importing && (
        <CourseImportModal
          token={token}
          onClose={() => setImporting(false)}
          onImported={load}
          onToast={setToast}
        />
      )}
    </>
  );
}
function LegacyCoursesPageV6({ token }) {
  const [courses, setCourses] = useState([]),
    [importing, setImporting] = useState(false),
    [editor, setEditor] = useState(null),
    [form, setForm] = useState({ code: "", name: "", isActive: true }),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [toast, setToast] = useState("");
  const perPage = 10;
  const load = () =>
    request("/admin/course-records", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => setCourses(data))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const save = async (e) => {
    e.preventDefault();
    try {
      await request(
        editor?.id
          ? `/admin/course-records/${editor.id}`
          : "/admin/course-records",
        {
          method: editor?.id ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        },
      );
      setEditor(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const totalPages = Math.max(1, Math.ceil(courses.length / perPage)),
    rows = courses.slice((page - 1) * perPage, page * perPage);
  const edit = (course) => {
    setForm(
      course
        ? {
            code: course.code,
            name: course.name,
            isActive: Boolean(course.is_active),
          }
        : { code: "", name: "", isActive: true },
    );
    setEditor(course || {});
  };
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Courses"
        description="Manage course master data used when students are verified at the kiosk."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import courses
            </Button>
            <Button onClick={() => edit(null)}>Add course</Button>
          </>
        }
      />
      <section className="student-summary">
        <article>
          <span>Total courses</span>
          <strong>{courses.length}</strong>
        </article>
        <article>
          <span>Active courses</span>
          <strong>{courses.filter((course) => course.is_active).length}</strong>
        </article>
        <article>
          <span>Linked students</span>
          <strong>
            {courses.reduce(
              (total, course) => total + Number(course.student_count),
              0,
            )}
          </strong>
        </article>
      </section>
      <section className="panel student-panel">
        <div className="course-intro">
          Courses here appear automatically in the Add Student course selector.
        </div>
        {error && <p className="error">{error}</p>}
        {courses.length ? (
          <>
            <div className="student-table-wrap">
              <table className="student-table">
                <thead>
                  <tr>
                    <th>Course code</th>
                    <th>Course name</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((course) => (
                    <tr key={course.id}>
                      <td>
                        <b>{course.code}</b>
                      </td>
                      <td>{course.name}</td>
                      <td>
                        <Status tone={course.is_active ? "green" : "gold"}>
                          {course.is_active ? "Active" : "Inactive"}
                        </Status>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => edit(course)}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>
                Page {page} of {totalPages}
              </span>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <Empty
            title="No courses yet"
            detail="Add a course or import a course spreadsheet."
            action={
              <Button onClick={() => setImporting(true)}>Import courses</Button>
            }
          />
        )}
      </section>
      {editor && (
        <div className="modal-backdrop" onMouseDown={() => setEditor(null)}>
          <section
            className="course-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">COURSE MASTER DATA</p>
                <h2>{editor.id ? "Edit course" : "Add course"}</h2>
                <p>Courses are available immediately after saving.</p>
              </div>
              <button className="modal-close" onClick={() => setEditor(null)}>
                &times;
              </button>
            </header>
            <form onSubmit={save}>
              <Field
                label="Course code"
                value={form.code}
                onChange={(value) => setForm({ ...form, code: value })}
              />
              <Field
                label="Course name"
                value={form.name}
                onChange={(value) => setForm({ ...form, name: value })}
              />
              <label className="status-toggle">
                <span>
                  <b>Active course</b>
                  <small>
                    Inactive courses cannot be selected for new students.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                />
                <i />
              </label>
              <footer>
                <Button variant="secondary" onClick={() => setEditor(null)}>
                  Cancel
                </Button>
                <button className="btn primary">Save course</button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {importing && (
        <CourseImportModal
          token={token}
          onClose={() => setImporting(false)}
          onImported={load}
          onToast={setToast}
        />
      )}
    </>
  );
}
function CoursesPage({ token }) {
  const tableRef = useRef(null);
  const [courses, setCourses] = useState([]),
    [levelFilter, setLevelFilter] = useState("all"),
    [showInactive, setShowInactive] = useState(false),
    [search, setSearch] = useState(""),
    [pageSize, setPageSize] = useState(10),
    [editor, setEditor] = useState(null),
    [confirm, setConfirm] = useState(false),
    [form, setForm] = useState({
      code: "",
      name: "",
      academicLevel: "COLLEGE",
      isActive: true,
    }),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const load = () =>
    request("/admin/course-records", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setCourses)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    tableRef.current?.dt()?.page(0).draw(false);
  }, [showInactive, levelFilter]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const edit = (course) => {
    setConfirm(false);
    setForm(
      course
        ? {
            code: course.code,
            name: course.name,
            academicLevel: course.academic_level || "OTHER",
            isActive: Boolean(course.is_active),
          }
        : { code: "", name: "", academicLevel: "COLLEGE", isActive: true },
    );
    setEditor(course || {});
  };
  const save = async () => {
    try {
      await request(
        editor?.id
          ? `/admin/course-records/${editor.id}`
          : "/admin/course-records",
        {
          method: editor?.id ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        },
      );
      setEditor(null);
      load();
      setToast("Course saved successfully.");
    } catch (err) {
      setError(err.message);
    }
  };
  const columns = [
    { data: "code", width: "14%" },
    { data: "name", width: "45%" },
    { data: "academic_level", width: "20%" },
    { data: "is_active", width: "12%" },
    { data: null, width: "9%", orderable: false, searchable: false },
  ];
  const levelLabels = {
    COLLEGE: "College",
    GRADUATE_SCHOOL: "Graduate school",
    OTHER: "Other / review",
  };
  const filteredCourses = courses.filter(
    (course) =>
      (showInactive || course.is_active) &&
      (levelFilter === "all" || course.academic_level === levelFilter),
  );
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Courses"
        description="Manage course master data used when students are verified at the kiosk."
        actions={<Button onClick={() => edit(null)}>Add course</Button>}
      />
      <section className="student-summary records-summary">
        <article>
          <span>Total courses</span>
          <strong>{courses.length}</strong>
        </article>
        <article>
          <span>Active courses</span>
          <strong>{courses.filter((course) => course.is_active).length}</strong>
        </article>
        <article>
          <span>Linked students</span>
          <strong>
            {courses.reduce(
              (total, course) => total + Number(course.student_count),
              0,
            )}
          </strong>
        </article>
      </section>
      <section className="panel student-panel courses-data-table records-data-table">
        <div className="course-intro">
          Only courses classified as College can use SATP. Review Other courses
          and set their academic level.
        </div>
        <div className="records-table-toolbar">
          <div className="records-table-filters">
            <label className="records-table-field">
              <span>Academic level</span>
              <select
                aria-label="Filter courses by academic level"
                value={levelFilter}
                onChange={(event) => setLevelFilter(event.target.value)}
              >
                <option value="all">All levels</option>
                {Object.entries(levelLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <InactiveRecordsToggle
              visible={showInactive}
              onChange={setShowInactive}
            />
          </div>
          <RecordsTableControls
            search={search}
            searchLabel="Search courses"
            searchPlaceholder="Search all columns"
            onSearchChange={(value) => {
              setSearch(value);
              tableRef.current?.dt()?.search(value).draw();
            }}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              tableRef.current?.dt()?.page.len(size).draw();
            }}
          />
        </div>
        {error && <p className="error">{error}</p>}
        {courses.length ? (
          <DataTable
            ref={tableRef}
            data={filteredCourses}
            columns={columns}
            slots={{
              0: (data, type, _row) =>
                type === "display" ? <b>{data}</b> : String(data ?? ""),
              2: (data) => levelLabels[data] || "Other / review",
              3: (data, type, _row) =>
                type === "display" ? (
                  <Status tone={data ? "green" : "danger"}>
                    {data ? "Active" : "Inactive"}
                  </Status>
                ) : type === "filter" ? (
                  data ? (
                    "Active"
                  ) : (
                    "Inactive"
                  )
                ) : (
                  Number(data)
                ),
              4: (_data, row) => (
                <Button variant="secondary" onClick={() => edit(row)}>
                  Edit
                </Button>
              ),
            }}
            options={{
              pageLength: pageSize,
              lengthMenu: [10, 25, 50, 100],
              layout: { topStart: null, topEnd: null },
              search: { search },
              autoWidth: false,
              order: [[0, "asc"]],
              language: {
                search: "Search courses:",
                emptyTable: "No courses found.",
              },
            }}
          >
            <thead>
              <tr>
                <th>Course code</th>
                <th>Course name</th>
                <th>Academic level</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
          </DataTable>
        ) : (
          <Empty
            title="No courses yet"
            detail="Add the first course, or use the Imports page for bulk uploads."
            action={<Button onClick={() => edit(null)}>Add course</Button>}
          />
        )}
      </section>
      {editor &&
        createPortal(
          <div className="course-editor-overlay">
            <div className="modal-backdrop" onMouseDown={() => setEditor(null)}>
              <section
                className="course-modal course-editor-modal"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <header>
                  <div>
                    <p className="eyebrow">COURSE MASTER DATA</p>
                    <h2>{editor.id ? "Edit course" : "Add course"}</h2>
                    <p>Courses are available immediately after saving.</p>
                  </div>
                  <button
                    className="modal-close"
                    onClick={() => setEditor(null)}
                  >
                    &times;
                  </button>
                </header>
                <form
                  id="course-editor-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setConfirm(true);
                  }}
                >
                  <Field
                    label="Course code"
                    value={form.code}
                    onChange={(value) => setForm({ ...form, code: value })}
                  />
                  <Field
                    label="Course name"
                    value={form.name}
                    onChange={(value) => setForm({ ...form, name: value })}
                  />
                  <label className="field">
                    <span>Academic level</span>
                    <select
                      required
                      value={form.academicLevel}
                      onChange={(event) =>
                        setForm({ ...form, academicLevel: event.target.value })
                      }
                    >
                      {Object.entries(levelLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <small className="field-hint">
                      Only College students can access SATP.
                    </small>
                  </label>
                  <label className="status-toggle">
                    <span>
                      <b>Active course</b>
                      <small>
                        Inactive courses cannot be selected for new students.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) =>
                        setForm({ ...form, isActive: e.target.checked })
                      }
                    />
                    <i />
                  </label>
                </form>
                <footer>
                  <Button variant="secondary" onClick={() => setEditor(null)}>
                    Cancel
                  </Button>
                  <button
                    className="btn primary"
                    type="submit"
                    form="course-editor-form"
                  >
                    Save course
                  </button>
                </footer>
              </section>
            </div>
            {confirm && (
              <ConfirmModal
                title={editor.id ? "Save course changes?" : "Add this course?"}
                message={
                  editor.id
                    ? `Update ${form.code} — ${form.name}?`
                    : `Add ${form.code} — ${form.name} to the course list?`
                }
                confirmLabel={editor.id ? "Save changes" : "Add course"}
                onClose={() => setConfirm(false)}
                onConfirm={save}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
function LegacyStudentsPageV5({ token }) {
  const [students, setStudents] = useState([]),
    [selected, setSelected] = useState(null),
    [adding, setAdding] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    request("/admin/students?page=1&limit=1000&status=all", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => setStudents(data.rows))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  const open = (id) =>
    request(`/admin/students/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setSelected)
      .catch((e) => setError(e.message));
  const columns = [
    { data: null },
    { data: "student_id" },
    { data: null },
    { data: "is_active" },
    null,
  ];
  return (
    <>
      <PageHeader
        title="Students"
        description="Select a student to view their profile and linked credentials."
        actions={
          <>
            <Button variant="secondary" onClick={() => go("/admin/imports")}>
              Import students
            </Button>
            <Button onClick={() => setAdding(true)}>Add student</Button>
          </>
        }
      />
      <section className="student-summary">
        <article>
          <span>Total students</span>
          <strong>{students.length}</strong>
        </article>
        <article>
          <span>Active students</span>
          <strong>
            {students.filter((student) => student.is_active).length}
          </strong>
        </article>
        <article>
          <span>Account types</span>
          <strong>4</strong>
          <small>SATP, Schoology, Kumosoft, email</small>
        </article>
      </section>
      <section className="panel student-panel students-data-table">
        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="loading-row">Loading student records...</p>
        ) : students.length ? (
          <DataTable
            data={students}
            columns={columns}
            slots={{
              0: (_data, row) => (
                <span className="student-cell">
                  <b>
                    {[row.first_name, row.middle_name, row.last_name]
                      .filter(Boolean)
                      .join(" ")}
                  </b>
                  <small>{row.kumosoft_id || "No Kumosoft ID"}</small>
                </span>
              ),
              2: (_data, row) => (
                <span className="student-cell">
                  <b>{row.course_code}</b>
                  <small>{row.course_name}</small>
                </span>
              ),
              3: (data) => (
                <Status tone={data ? "green" : "gold"}>
                  {data ? "Active" : "Inactive"}
                </Status>
              ),
              4: (_data, row) => (
                <Button variant="secondary" onClick={() => open(row.id)}>
                  View profile
                </Button>
              ),
            }}
            options={{
              pageLength: 10,
              lengthMenu: [10, 25, 50, 100],
              order: [[1, "asc"]],
              initComplete: addDataTablePageJump,
              language: {
                search: "Search students:",
                emptyTable: "No students found.",
              },
            }}
          >
            <thead>
              <tr>
                <th>Student</th>
                <th>School ID</th>
                <th>Course</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
          </DataTable>
        ) : (
          <Empty
            title="No students found"
            detail="Import student records or add the first student manually."
            action={
              <Button onClick={() => setAdding(true)}>Add student</Button>
            }
          />
        )}
      </section>
      {adding && (
        <StudentFormModal
          token={token}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      <StudentProfileModal
        record={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
const pageMeta = {
  "/admin/students": [
    "Students",
    "Search, view, create, and maintain enrolled student records.",
    "Add student",
    "No student records",
    "Import students or add a student manually to begin.",
  ],
  "/admin/vouchers": [
    "WiFi vouchers",
    "Monitor stock and control voucher assignment for the current academic period.",
    "Add vouchers",
    "No voucher records",
    "Import voucher codes before student retrieval begins.",
  ],
  "/admin/release-vouchers": [
    "Release vouchers",
    "Prepare available WiFi vouchers for permanent external release.",
    "",
    "No vouchers ready for release",
    "Choose a quantity to prepare available voucher codes.",
  ],
  "/admin/imports": [
    "Imports",
    "Upload and validate students, credentials, and WiFi vouchers from CSV or XLSX.",
    "Start import",
    "No imports yet",
    "Select Start import to choose an import type and file.",
  ],
  "/admin/transactions": [
    "Transactions",
    "Review student verification attempts, credential views, and voucher activity.",
    "Export report",
    "No transactions yet",
    "Activity is recorded after kiosk use.",
  ],
  "/admin/kiosks": [
    "Kiosks",
    "Monitor dispenser devices and their latest heartbeat.",
    "",
    "No kiosks registered",
    "Register the first kiosk and generate its secret.",
  ],
  "/admin/users": [
    "Admin users",
    "Create and maintain administrator accounts and access roles.",
    "Add administrator",
    "No additional administrators",
    "The initial Super Admin account is active.",
  ],
};
function LegacyStudentsPage({ token }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ rows: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: "20",
      status,
    });
    if (search.trim()) params.set("search", search.trim());
    request(`/admin/students?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [page, status]);
  const applySearch = (e) => {
    e.preventDefault();
    setPage(1);
    load();
  };
  return (
    <>
      <PageHeader
        title="Students"
        description="Manage enrolled student records used for secure kiosk verification."
        actions={
          <>
            <Button variant="secondary" onClick={() => go("/admin/imports")}>
              Import students
            </Button>
            <Button
              onClick={() => alert("Student creation form is next to connect.")}
            >
              Add student
            </Button>
          </>
        }
      />
      <section className="student-summary">
        <article>
          <span>Total records</span>
          <strong>{result.total}</strong>
        </article>
        <article>
          <span>Current page</span>
          <strong>
            {result.page || 1} of {result.pages}
          </strong>
        </article>
        <article>
          <span>Verification fields</span>
          <strong>4</strong>
          <small>ID, surname, birthday, course</small>
        </article>
      </section>
      <section className="panel student-panel">
        <form className="student-toolbar" onSubmit={applySearch}>
          <div className="search-wrap">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student ID, Kumosoft ID, or name"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <button className="btn secondary">Search</button>
        </form>
        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="loading-row">Loading student records...</p>
        ) : result.rows.length ? (
          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Student ID</th>
                  <th>Course</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <b>
                        {[
                          student.first_name,
                          student.middle_name,
                          student.last_name,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      </b>
                      <small>{student.kumosoft_id || "No Kumosoft ID"}</small>
                    </td>
                    <td>{student.student_id}</td>
                    <td>
                      <b>{student.course_code}</b>
                      <small>{student.course_name}</small>
                    </td>
                    <td>{student.year_level || "-"}</td>
                    <td>
                      <Status tone={student.is_active ? "green" : "gold"}>
                        {student.is_active ? "Active" : "Inactive"}
                      </Status>
                    </td>
                    <td>
                      <button
                        className="row-action"
                        onClick={() =>
                          alert(
                            `Student profile for ${student.student_id} is next to connect.`,
                          )
                        }
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No students found"
            detail={
              search
                ? "Try a different search or clear the filter."
                : "Import student records or add the first student manually."
            }
            action={
              <Button onClick={() => go("/admin/imports")}>
                Import students
              </Button>
            }
          />
        )}
        <footer className="table-footer">
          <span>
            Showing {result.rows.length} of {result.total} students
          </span>
          <div>
            <button
              className="page-button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="page-button"
              disabled={page >= result.pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </>
  );
}
function LegacyStudentProfileModalV1({ record, onClose }) {
  if (!record) return null;
  const student = record.student;
  const name = [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(" ");
  const accounts = {
    SATP: null,
    SCHOOLOGY: null,
    KUMOSOFT: null,
    EMAIL: null,
    ...Object.fromEntries(record.accounts.map((item) => [item.type, item])),
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="student-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">STUDENT PROFILE</p>
            <h2>{name}</h2>
            <p>
              {student.student_id} · {student.course_code}
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="profile-grid">
          <article>
            <h3>Student information</h3>
            <dl>
              <dt>School ID</dt>
              <dd>{student.student_id}</dd>
              <dt>Last name</dt>
              <dd>{student.last_name}</dd>
              <dt>First name</dt>
              <dd>{student.first_name}</dd>
              <dt>Middle name</dt>
              <dd>{student.middle_name || "-"}</dd>
              <dt>Course</dt>
              <dd>
                {student.course_code} - {student.course_name}
              </dd>
              <dt>Birthday</dt>
              <dd>{new Date(student.birth_date).toLocaleDateString()}</dd>
              <dt>Status</dt>
              <dd>
                <Status tone={student.is_active ? "green" : "gold"}>
                  {student.is_active ? "Active" : "Inactive"}
                </Status>
              </dd>
            </dl>
          </article>
          <article className="account-panel">
            <h3>Linked accounts</h3>
            {Object.entries(accounts).map(([type, account]) => (
              <div className="account-row" key={type}>
                <b>{type === "EMAIL" ? "Institutional email" : type}</b>
                {account ? (
                  <>
                    <span>{account.username}</span>
                    <code>{account.password}</code>
                  </>
                ) : (
                  <em>Not available</em>
                )}
              </div>
            ))}
          </article>
        </div>
        <footer>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </footer>
      </section>
    </div>
  );
}
function StudentProfileModal({ record, onClose, onEdit }) {
  if (!record) return null;
  const student = record.student,
    name = [student.first_name, student.middle_name, student.last_name]
      .filter(Boolean)
      .join(" ");
  const accounts = {
    SATP: null,
    SCHOOLOGY: null,
    KUMOSOFT: null,
    EMAIL: null,
    ...Object.fromEntries(
      record.accounts.map((account) => [account.type, account]),
    ),
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="student-modal profile-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">STUDENT PROFILE</p>
            <h2>{name}</h2>
            <p>
              {student.student_id} · {student.course_code}
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </header>
        <div className="profile-grid">
          <article>
            <h3>Student information</h3>
            <dl>
              <dt>School ID</dt>
              <dd>{student.student_id}</dd>
              <dt>Last name</dt>
              <dd>{student.last_name}</dd>
              <dt>First name</dt>
              <dd>{student.first_name}</dd>
              <dt>Middle name</dt>
              <dd>{student.middle_name || "-"}</dd>
              <dt>Course</dt>
              <dd>
                {student.course_code} - {student.course_name}
              </dd>
              <dt>Birthday</dt>
              <dd>{new Date(student.birth_date).toLocaleDateString()}</dd>
              <dt>Status</dt>
              <dd>
                <Status tone={student.is_active ? "green" : "danger"}>
                  {student.is_active ? "Active" : "Inactive"}
                </Status>
              </dd>
            </dl>
            <div className="voucher-card">
              <span>WiFi voucher</span>
              {record.voucher ? (
                <>
                  <b>{record.voucher.code}</b>
                  <small>
                    Assigned{" "}
                    {record.voucher.assignedAt
                      ? new Date(record.voucher.assignedAt).toLocaleDateString()
                      : ""}
                  </small>
                </>
              ) : (
                <em>No voucher assigned</em>
              )}
            </div>
          </article>
          <article className="account-panel">
            <h3>Linked accounts</h3>
            {Object.entries(accounts).map(([type, account]) => (
              <div className="account-row" key={type}>
                <b>{type === "EMAIL" ? "Institutional email" : type}</b>
                {account ? (
                  <div className="account-credentials">
                    <span>
                      <small>{type === "EMAIL" ? "Email" : "Username"}</small>
                      {account.username}
                    </span>
                    <code>
                      <small>Password</small>
                      {account.password || "Not provided"}
                    </code>
                  </div>
                ) : (
                  <em>Not available</em>
                )}
              </div>
            ))}
          </article>
        </div>
        <footer className="profile-footer">
          {onEdit && <Button onClick={onEdit}>Edit student</Button>}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </footer>
      </section>
    </div>
  );
}
function LegacyStudentsPageV2({ token }) {
  const [result, setResult] = useState({
    rows: [],
    total: 0,
    pages: 1,
    page: 1,
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ page: "1", limit: "50", status });
    if (search.trim()) query.set("search", search.trim());
    request(`/admin/students?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [status]);
  const open = (id) =>
    request(`/admin/students/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setSelected)
      .catch((e) => setError(e.message));
  return (
    <>
      <PageHeader
        title="Students"
        description="Select a student to view their profile and linked credentials."
        actions={
          <>
            <Button variant="secondary" onClick={() => go("/admin/imports")}>
              Import students
            </Button>
            <Button
              onClick={() => alert("Student creation form is next to connect.")}
            >
              Add student
            </Button>
          </>
        }
      />
      <section className="student-summary">
        <article>
          <span>Total records</span>
          <strong>{result.total}</strong>
        </article>
        <article>
          <span>Available account types</span>
          <strong>4</strong>
        </article>
        <article>
          <span>Verification fields</span>
          <strong>4</strong>
          <small>ID, surname, birthday, course</small>
        </article>
      </section>
      <section className="panel student-panel">
        <form
          className="student-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <div className="search-wrap">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student ID, Kumosoft ID, or name"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <button className="btn secondary">Search</button>
        </form>
        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="loading-row">Loading student records...</p>
        ) : result.rows.length ? (
          <div className="student-table-wrap">
            <table className="student-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>School ID</th>
                  <th>Course</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((s) => (
                  <tr
                    key={s.id}
                    className="student-clickable"
                    onClick={() => open(s.id)}
                  >
                    <td>
                      <b>
                        {[s.first_name, s.middle_name, s.last_name]
                          .filter(Boolean)
                          .join(" ")}
                      </b>
                      <small>{s.kumosoft_id || "No Kumosoft ID"}</small>
                    </td>
                    <td>{s.student_id}</td>
                    <td>
                      <b>{s.course_code}</b>
                      <small>{s.course_name}</small>
                    </td>
                    <td>{s.year_level || "-"}</td>
                    <td>
                      <Status tone={s.is_active ? "green" : "gold"}>
                        {s.is_active ? "Active" : "Inactive"}
                      </Status>
                    </td>
                    <td>
                      <button
                        className="row-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(s.id);
                        }}
                      >
                        View profile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No students found"
            detail="Import student records or change the filters."
            action={
              <Button onClick={() => go("/admin/imports")}>
                Import students
              </Button>
            }
          />
        )}
        <footer className="table-footer">
          <span>
            Showing {result.rows.length} of {result.total} students
          </span>
        </footer>
      </section>
      <StudentProfileModal
        record={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
const importTypes = [
  {
    id: "courses",
    title: "Courses",
    detail: "CourseCode, CourseName, optional AcademicLevel",
    endpoint: "/admin/course-records/import",
  },
  {
    id: "students",
    title: "Students",
    detail:
      "SchoolID, optional KumosoftID, LastName, FirstName, MiddleName, BirthDate, and CourseCode",
    endpoint: "/admin/imports/students",
  },
  {
    id: "student-deactivate",
    title: "Deactivate students",
    detail: "SchoolID (one student per row)",
    endpoint: "/admin/imports/student-deactivate",
  },
  {
    id: "satp",
    title: "SATP accounts",
    detail: "SchoolID and Password",
    endpoint: "/admin/imports/satp",
  },
  {
    id: "schoology",
    title: "Schoology accounts",
    detail: "SchoolID and Password",
    endpoint: "/admin/imports/schoology",
  },
  {
    id: "kumosoft",
    title: "Kumosoft accounts",
    detail: "SchoolID, KumosoftID, and Password",
    endpoint: "/admin/imports/kumosoft",
  },
  {
    id: "email",
    title: "Institutional email",
    detail: "SchoolID, EmailAddress, and Password",
    endpoint: "/admin/imports/email",
  },
  {
    id: "vouchers",
    title: "WiFi vouchers",
    detail: "VoucherCode",
    endpoint: "/admin/voucher-records/import",
    xlsxOnly: true,
  },
];

const voucherImportType = importTypes.find((type) => type.id === "vouchers");

async function downloadImportTemplate(type, token) {
  const response = await adminFetch(`/admin/imports/${type.id}/template`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    let message = "Unable to download the import template.";
    try {
      message = (await response.json()).message || message;
    } catch {}
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${type.id}-import-template.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadCredentialWorkbook(token) {
  const response = await adminFetch("/admin/account-exports", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    let message = "Unable to export account credentials.";
    try {
      message = (await response.json()).message || message;
    } catch {}
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "credential-account-export.xlsx";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadErrorReport(base64, type) {
  if (!base64) return;
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${type}-import-errors.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ImportModalFrame({ children, busy, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop import-review-overlay"
      onMouseDown={busy ? undefined : onClose}
    >
      {children}
    </div>,
    document.body,
  );
}

function ImportValidationGroups({
  groups,
  sections,
  onLoadMore,
  busy,
  loadingGroup,
}) {
  return (
    <div className="mssql-validation-groups">
      {sections.map(([title, tone, kind, count, empty]) => {
        const group = groups?.[kind];
        const rows = group?.records || [];
        return (
          <section className={`mssql-validation-group ${tone}`} key={kind}>
            <header>
              <span>{title}</span>
              <b>{count || 0}</b>
            </header>
            {rows.length ? (
              <div className="mssql-validation-rows">
                {rows.map((row) => (
                  <article key={`${kind}-${row.row}`}>
                    <small>Row {row.row}</small>
                    <span>
                      {row.label ??
                        (row.schoolId
                          ? `${row.schoolId} — ${row.name} (${row.courseCode})`
                          : row.message)}
                    </span>
                    {(row.label || row.schoolId) && row.message && (
                      <em>{row.message}</em>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p>{empty}</p>
            )}
            {group?.hasMore && (
              <footer>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onLoadMore(kind, group.nextOffset)}
                >
                  {loadingGroup === kind ? "Loading..." : "Load next 250"}
                </Button>
              </footer>
            )}
          </section>
        );
      })}
    </div>
  );
}

function fileImportSections(type, validation) {
  const noun =
    type.id === "courses"
      ? "courses"
      : type.id === "students"
        ? "students"
        : type.id === "vouchers"
          ? "vouchers"
          : "accounts";
  const sections =
    type.id === "student-deactivate"
      ? [
          [
            "Students to deactivate",
            "errors",
            "new",
            validation.new,
            "No students will be deactivated.",
          ],
        ]
      : [
          [
            `New ${noun}`,
            "created",
            "new",
            validation.new,
            `No ${noun} will be created.`,
          ],
        ];
  if (type.id === "vouchers") {
    sections.push([
      "Duplicate vouchers",
      "updated",
      "duplicate",
      validation.duplicates,
      "No duplicate vouchers found.",
    ]);
  } else if (type.id !== "student-deactivate") {
    sections.push([
      `Updated ${noun}`,
      "updated",
      "update",
      validation.update,
      `No ${noun} will be updated.`,
    ]);
  }
  if (type.id === "courses") {
    sections.push([
      "Unchanged courses",
      "unchanged",
      "unchanged",
      validation.unchanged,
      "No unchanged courses found.",
    ]);
  }
  sections.push([
    "Errors",
    "errors",
    "error",
    validation.invalid ?? validation.errors?.length ?? 0,
    "No errors found.",
  ]);
  return sections;
}

function ImportHubModal({ type, token, onClose, onComplete }) {
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importErrorReport, setImportErrorReport] = useState(null);
  const [loadingGroup, setLoadingGroup] = useState("");
  const send = async (suffix = "") => {
    const body = new FormData();
    body.append("file", file);
    const response = await adminFetch(`${type.endpoint}${suffix}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message || "Import failed.");
      error.errorReport = data.errorReport;
      throw error;
    }
    return data;
  };
  const validate = async (event) => {
    event.preventDefault();
    if (!file) return setError("Choose a file first.");
    setBusy(true);
    setError("");
    setImportErrorReport(null);
    try {
      const result = await send("/validate");
      setValidation(result);
    } catch (err) {
      setError(err.message);
      setImportErrorReport(err.errorReport || null);
      if (err.errorReport) downloadErrorReport(err.errorReport, type.id);
    } finally {
      setBusy(false);
    }
  };
  const runImport = async () => {
    setBusy(true);
    setError("");
    setImportErrorReport(null);
    try {
      const result = await send();
      const inserted = Number(result.inserted ?? result.added ?? 0);
      const updated = Number(result.updated ?? 0);
      const skipped = Number(result.invalid ?? result.errors?.length ?? 0);
      if (result.errorReport) downloadErrorReport(result.errorReport, type.id);
      onComplete(
        type.id === "student-deactivate"
          ? `${result.deactivated || 0} student${result.deactivated === 1 ? "" : "s"} deactivated${skipped ? `; ${skipped} invalid row${skipped === 1 ? "" : "s"} skipped` : ""}.`
          : `${type.title}: ${inserted} added${updated ? `, ${updated} updated` : ""}${skipped ? `; ${skipped} unmatched or invalid row${skipped === 1 ? "" : "s"} skipped` : ""}.`,
      );
      onClose();
    } catch (err) {
      setError(err.message);
      setImportErrorReport(err.errorReport || null);
      if (err.errorReport) downloadErrorReport(err.errorReport, type.id);
    } finally {
      setBusy(false);
    }
  };
  const loadValidationPage = async (category, offset) => {
    setBusy(true);
    setLoadingGroup(category);
    setError("");
    try {
      const params = new URLSearchParams({ category, offset });
      const data = await send(`/validate?${params}`);
      setValidation((current) => ({
        ...current,
        groups: {
          ...current.groups,
          [category]: {
            ...data.page,
            records: [
              ...current.groups[category].records,
              ...data.page.records,
            ],
          },
        },
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setLoadingGroup("");
    }
  };
  const invalid = Number(
    validation?.invalid ?? validation?.errors?.length ?? 0,
  );
  // Voucher imports never update existing codes. Some validation responses
  // report duplicate rows in `update`, so only genuinely new vouchers count
  // as importable records.
  const changes =
    type.id === "vouchers"
      ? Number(validation?.new || 0)
      : Number(validation?.new || 0) + Number(validation?.update || 0);
  return (
    <ImportModalFrame busy={busy} onClose={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        className={`course-modal bulk-import-modal import-hub-modal import-review-modal${validation ? " is-validation" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">
              {validation ? "VALIDATION COMPLETE" : "BULK IMPORT"}
            </p>
            <h2>
              {validation
                ? `Review import: ${type.title}`
                : `Import ${type.title}`}
            </h2>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            &times;
          </button>
        </header>
        {validation ? (
          <div className="validation-result mssql-validation-result">
            <div className="mssql-validation-body">
              <p className="mssql-validation-copy">
                Review the grouped rows before importing. Each list initially
                shows up to 250 rows; loading more is optional and does not
                affect the import. Rows with errors will be skipped.
              </p>
              <ImportValidationGroups
                groups={validation.groups}
                sections={fileImportSections(type, validation)}
                onLoadMore={loadValidationPage}
                busy={busy}
                loadingGroup={loadingGroup}
              />
              <div className="import-validation-notes">
                {invalid > 0 && validation.errorReport && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      downloadErrorReport(validation.errorReport, type.id)
                    }
                  >
                    <AppIcon name="download" /> Download error rows
                  </Button>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                {importErrorReport && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      downloadErrorReport(importErrorReport, type.id)
                    }
                  >
                    <AppIcon name="download" /> Download failed rows
                  </Button>
                )}
                {busy && !loadingGroup && (
                  <p className="import-progress" role="status">
                    <span
                      className="import-progress-spinner"
                      aria-hidden="true"
                    >
                      <AppIcon name="progress_activity" size={19} />
                    </span>
                    <span>
                      Importing {changes} records. Please keep this window open.
                    </span>
                  </p>
                )}
              </div>
            </div>
            <footer>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setValidation(null);
                  setError("");
                }}
              >
                Choose another file
              </Button>
              <button
                className="btn primary"
                disabled={busy || changes < 1}
                onClick={runImport}
              >
                {busy && !loadingGroup
                  ? "Importing..."
                  : type.id === "student-deactivate"
                    ? `Deactivate ${changes} students`
                    : `Import ${changes} records`}
              </button>
            </footer>
          </div>
        ) : (
          <form onSubmit={validate}>
            <label className="bulk-file-picker">
              <input
                type="file"
                accept={type.xlsxOnly ? ".xlsx" : ".csv,.xlsx,.xls"}
                disabled={busy}
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setError("");
                }}
              />
              <span className="upload-icon">&#8679;</span>
              <b>
                {file
                  ? file.name
                  : `Choose ${type.xlsxOnly ? "an Excel" : "a CSV or Excel"} file`}
              </b>
              <small>
                {file
                  ? "Ready to validate"
                  : `Required columns: ${type.detail}`}
              </small>
            </label>
            <p className="template-link">
              Need the format?{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  downloadImportTemplate(type, token).catch((err) =>
                    setError(err.message),
                  )
                }
              >
                Download template
              </button>
            </p>
            {error && <p className="error">{error}</p>}
            <footer>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <button className="btn primary" disabled={busy || !file}>
                {busy ? "Validating..." : "Validate file"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </ImportModalFrame>
  );
}

function MssqlStudentImportModal({ token, onClose, onComplete }) {
  const [activePeriod, setActivePeriod] = useState(null),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [loadingGroup, setLoadingGroup] = useState(""),
    [confirmDeactivation, setConfirmDeactivation] = useState(false),
    [updateExistingBirthdays, setUpdateExistingBirthdays] = useState(false),
    [error, setError] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => {
    request("/admin/academic-periods", { headers })
      .then((periods) =>
        setActivePeriod(periods.find((period) => period.isCurrent) || null),
      )
      .catch((err) => setError(err.message));
  }, []);
  const loadPreview = async (
    category = "",
    offset = 0,
    birthdayOption = updateExistingBirthdays,
  ) => {
    setBusy(true);
    setLoadingGroup(category || "all");
    setError("");
    try {
      const params = new URLSearchParams({ offset, updateExistingBirthdays: birthdayOption });
      if (category) params.set("category", category);
      const data = await request(
        `/admin/imports/mssql-students/preview?${params}`,
        { headers },
      );
      setPreview((current) =>
        !category
          ? data
          : {
              ...current,
              groups: {
                ...current.groups,
                [category]: {
                  ...data.page,
                  records: [
                    ...(current.groups[category]?.records || []),
                    ...data.page.records,
                  ],
                },
              },
            },
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setLoadingGroup("");
    }
  };
  const previewIsCurrent = preview?.updateExistingBirthdays === updateExistingBirthdays;
  const importStudents = async () => {
    if (busy || !previewIsCurrent) return;
    setBusy(true);
    setError("");
    try {
      const result = await request("/admin/imports/mssql-students", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmDeactivation,
          updateExistingBirthdays,
        }),
      });
      onComplete(result.message);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const birthdayToggle = (
    <label className="status-toggle mssql-birthday-toggle">
      <span>
        <b>Update existing birthdays</b>
        <small>
          {updateExistingBirthdays
            ? "Overwrite saved birthdays with SQL Server values."
            : "Keep birthdays already saved in this system."}
          {" "}New students always use the SQL Server birthday.
        </small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label="Update existing birthdays"
        checked={updateExistingBirthdays}
        disabled={busy}
        onChange={(event) => {
          const enabled = event.target.checked;
          setUpdateExistingBirthdays(enabled);
          setConfirmDeactivation(false);
          if (preview) loadPreview("", 0, enabled);
        }}
      />
      <i aria-hidden="true" />
    </label>
  );
  return (
    <ImportModalFrame busy={busy} onClose={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        className={`course-modal bulk-import-modal mssql-student-import-modal import-review-modal${preview ? " is-validation" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">
              {preview ? "VALIDATION COMPLETE" : "SQL SERVER IMPORT"}
            </p>
            <h2>
              {preview
                ? "Review student enrollment import"
                : "Import enrolled students"}
            </h2>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            &times;
          </button>
        </header>
        {!preview ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadPreview();
            }}
          >
            <p className="form-note">
              Pulls student records from the configured SQL Server view. The
              current academic period is used automatically to filter the
              source.
            </p>
            <div className="active-import-period">
              <AppIcon name="calendar_month" size={22} />
              <span>
                <small>ACTIVE ACADEMIC PERIOD</small>
                <b>
                  {activePeriod
                    ? `${activePeriod.schoolYear} · ${activePeriod.semester}`
                    : "Loading active period..."}
                </b>
              </span>
            </div>
            {birthdayToggle}
            {error && <p className="error">{error}</p>}
            <footer>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <button className="btn primary" disabled={busy || !activePeriod}>
                {busy ? "Loading..." : "Preview students"}
              </button>
            </footer>
          </form>
        ) : (
          <div
            className="validation-result mssql-validation-result"
            aria-busy={busy && Boolean(loadingGroup)}
          >
            <div className="mssql-validation-body">
              <p className="eyebrow">
                {preview.period.schoolYear} ·{" "}
                {preview.period.term || `Semester ${preview.period.semester}`}
              </p>
              <h3>Review semester student import</h3>
              {birthdayToggle}
              <div className="validation-summary">
                <span>
                  <b>{preview.total}</b> source rows
                </span>
                <span>
                  <b>{preview.new}</b> new
                </span>
                <span>
                  <b>{preview.update}</b> updates
                </span>
                <span className={preview.invalid ? "has-errors" : ""}>
                  <b>{preview.invalid}</b> invalid
                </span>
              </div>
              <p className="mssql-validation-copy">
                Review all detected rows before updating enrollment records.
                Each list initially shows up to 250 rows; loading more rows is
                optional and does not affect the import.
              </p>
              <ImportValidationGroups
                groups={preview.groups}
                sections={[
                  [
                    "Created students",
                    "created",
                    "new",
                    preview.new,
                    "No students will be created.",
                  ],
                  [
                    "Updated students",
                    "updated",
                    "update",
                    preview.update,
                    "No students will be updated.",
                  ],
                  [
                    "Errors",
                    "errors",
                    "error",
                    preview.invalid,
                    "No errors found.",
                  ],
                ]}
                onLoadMore={loadPreview}
                busy={busy || !previewIsCurrent}
                loadingGroup={loadingGroup}
              />
              <p className="mssql-sync-warning">
                <b>{preview.deactivate}</b> currently active student
                {preview.deactivate === 1 ? " is" : "s are"} not in this
                semester&apos;s source list and will be deactivated.
              </p>
              {preview.deactivate > 0 && (
                <label className="mssql-deactivation-confirmation">
                  <input
                    type="checkbox"
                    checked={confirmDeactivation}
                    onChange={(event) =>
                      setConfirmDeactivation(event.target.checked)
                    }
                  />
                  <span>
                    I reviewed the source and approve deactivating these
                    students.
                  </span>
                </label>
              )}
              {error && <p className="error">{error}</p>}
              {!previewIsCurrent && !busy && (
                <Button variant="secondary" onClick={() => loadPreview()}>
                  Retry preview
                </Button>
              )}
            </div>
            <footer>
              <button
                className="btn primary"
                disabled={
                  busy ||
                  !previewIsCurrent ||
                  (!preview.new && !preview.update) ||
                  (preview.deactivate > 0 && !confirmDeactivation)
                }
                onClick={importStudents}
              >
                {busy
                  ? loadingGroup
                    ? "Updating preview..."
                    : "Importing..."
                  : "Import and synchronize"}
              </button>
            </footer>
          </div>
        )}
      </section>
    </ImportModalFrame>
  );
}

function ImportsPage({ token }) {
  const [activeType, setActiveType] = useState(null);
  const [mssqlImportOpen, setMssqlImportOpen] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const template = (type) =>
    downloadImportTemplate(type, token).catch((err) => setError(err.message));
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Imports"
        description="Download the required template, validate your file, and import records in bulk."
        actions={
          <Button variant="secondary" onClick={() => setConfirmExport(true)}>
            <AppIcon name="download" /> Export account workbook
          </Button>
        }
      />
      {error && <p className="error imports-page-error">{error}</p>}
      <section className="panel import-hub-card mssql-import-card">
        <div className="import-card-icon">SQL</div>
        <div className="import-card-copy">
          <h2>SQL Server students</h2>
          <p>Pull enrolled students directly from the configured MSSQL view.</p>
          <small>
            Uses the current academic period automatically. Review the result
            before importing.
          </small>
        </div>
        <footer>
          <Button onClick={() => setMssqlImportOpen(true)}>
            Import from SQL Server
          </Button>
        </footer>
      </section>
      <section className="import-hub-grid">
        {importTypes.map((type, index) => (
          <article
            className={`panel import-hub-card${type.id === "student-deactivate" ? " deactivation-import-card" : ""}`}
            key={type.id}
          >
            <div className="import-card-icon">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="import-card-copy">
              <h2>{type.title}</h2>
              <p>{type.detail}</p>
              <small>
                {type.id === "student-deactivate"
                  ? "Marks matched students inactive"
                  : type.xlsxOnly
                    ? "XLSX format"
                    : "CSV or XLSX format"}
              </small>
            </div>
            <footer>
              <Button variant="secondary" onClick={() => template(type)}>
                Download template
              </Button>
              <Button onClick={() => setActiveType(type)}>Upload file</Button>
            </footer>
          </article>
        ))}
      </section>
      {activeType && (
        <ImportHubModal
          type={activeType}
          token={token}
          onClose={() => setActiveType(null)}
          onComplete={setToast}
        />
      )}
      {mssqlImportOpen && (
        <MssqlStudentImportModal
          token={token}
          onClose={() => setMssqlImportOpen(false)}
          onComplete={setToast}
        />
      )}
      {confirmExport && (
        <ConfirmModal
          title="Export account credentials?"
          message="This downloads all active usernames and passwords in one XLSX workbook. It contains separate sheets for SATP, Schoology, Kumosoft, and Email, and the export is recorded in the audit log."
          confirmLabel="Download workbook"
          onClose={() => setConfirmExport(false)}
          onConfirm={() => {
            setConfirmExport(false);
            downloadCredentialWorkbook(token)
              .then(() => setToast("Credential workbook downloaded."))
              .catch((err) => setError(err.message));
          }}
        />
      )}
    </>
  );
}

function KioskUsageStatus({ kiosk }) {
  const state = kiosk.usage_status || (kiosk.is_online ? "UNKNOWN" : "OFFLINE");
  const labels = {
    IN_USE: "In use",
    IDLE: "Idle",
    UNKNOWN: "Unknown",
    OFFLINE: "Offline",
  };
  return (
    <span className="kiosk-usage" data-status={state}>
      <span>{labels[state] || "Unknown"}</span>
      {state === "IN_USE" && (
        <small>
          {kiosk.activity_state === "VIEWING_CREDENTIALS"
            ? "Viewing credentials"
            : "Entering details"}
        </small>
      )}
    </span>
  );
}

function KiosksPage({ token }) {
  const [kiosks, setKiosks] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [selectedId, setSelectedId] = useState(null),
    [details, setDetails] = useState(null),
    [detailsLoading, setDetailsLoading] = useState(false),
    [pendingAction, setPendingAction] = useState(""),
    [toast, setToast] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      setKiosks(await request("/admin/kiosks", { headers }));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  };
  useEffect(() => {
    load();
    const timer = setInterval(() => load({ quiet: true }), 3000);
    return () => clearInterval(timer);
  }, [token]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const openKiosk = async (id) => {
    setSelectedId(id);
    setDetailsLoading(true);
    try {
      setDetails(await request(`/admin/kiosks/${id}`, { headers }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailsLoading(false);
    }
  };
  useEffect(() => {
    if (!selectedId && kiosks[0]) openKiosk(kiosks[0].id);
  }, [kiosks]);
  useEffect(() => {
    if (!selectedId) return;
    const refreshDetails = () =>
      request(`/admin/kiosks/${selectedId}`, { headers })
        .then(setDetails)
        .catch((err) => setError(err.message));
    const timer = setInterval(refreshDetails, 3000);
    return () => clearInterval(timer);
  }, [selectedId, token]);
  const queueAction = async () => {
    if (!pendingAction || !selectedId) return;
    try {
      const response = await request(`/admin/kiosks/${selectedId}/actions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: pendingAction }),
      });
      setToast(response.message);
      setPendingAction("");
      openKiosk(selectedId);
    } catch (err) {
      setError(err.message);
      setPendingAction("");
    }
  };
  const online = kiosks.filter((item) => item.is_online).length;
  const inUse = kiosks.filter((item) => item.usage_status === "IN_USE").length;
  const filtered = kiosks.filter((item) =>
    matchesTableSearch(query, kioskSearchValues(item)),
  );
  const selected = details?.kiosk;
  const actionLabel = {
    reload: "Reload dispenser",
    restartBrowser: "Restart browser",
    reboot: "Reboot device",
    shutdown: "Shut down device",
  };
  const duration = (seconds) => {
    if (!Number.isFinite(Number(seconds))) return "Not reported";
    const value = Math.max(0, Number(seconds));
    const days = Math.floor(value / 86400),
      hours = Math.floor((value % 86400) / 3600),
      minutes = Math.floor((value % 3600) / 60);
    return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`]
      .filter(Boolean)
      .join(" ");
  };
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Kiosks"
        description="Monitor dispenser devices that have opened and connected to the system."
        actions={
          <Button variant="secondary" onClick={() => load()}>
            <AppIcon name="refresh" /> Refresh
          </Button>
        }
      />
      <section className="student-summary kiosk-admin-summary">
        <article>
          <span>Detected kiosks</span>
          <strong>{kiosks.length}</strong>
        </article>
        <article>
          <span>Online now</span>
          <strong>{online}</strong>
        </article>
        <article>
          <span>In use now</span>
          <strong>{inUse}</strong>
        </article>
        <article>
          <span>Offline</span>
          <strong>{kiosks.length - online}</strong>
        </article>
      </section>
      <section className="panel kiosk-admin-panel">
        <div className="course-intro">
          Updates every three seconds. In use means someone is entering details
          or viewing credentials. Usage becomes idle after 30 seconds without
          interaction; unknown means activity reports are unavailable. Online
          means the device has connected within the last five minutes.
        </div>
        {error && <p className="error">{error}</p>}
        {loading ? (
          <div className="kiosk-loading" role="status">
            <span className="loading-spinner" /> Loading kiosks...
          </div>
        ) : kiosks.length ? (
          <>
            <div className="kiosk-monitor-toolbar">
              <label>
                <AppIcon name="search" size={19} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search all columns"
                  aria-label="Search kiosks"
                />
              </label>
              <small>
                {filtered.length} of {kiosks.length} devices
              </small>
            </div>
            <div className="kiosk-admin-table-wrap">
              <table className="kiosk-admin-table kiosk-monitor-table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Device</th>
                    <th>Status</th>
                    <th>Usage</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={item.id === selectedId ? "selected" : ""}
                      onClick={() => openKiosk(item.id)}
                    >
                      <td>
                        {item.location || (
                          <span className="muted-cell">Not reported</span>
                        )}
                      </td>
                      <td>
                        <span className="student-cell">
                          <b>{item.kiosk_name}</b>
                          <small>{item.kiosk_code}</small>
                        </span>
                      </td>
                      <td>
                        <span
                          className={`kiosk-connection ${item.is_online ? "online" : "offline"}`}
                        >
                          <i />
                          {item.is_online ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td>
                        <KioskUsageStatus kiosk={item} />
                      </td>
                      <td>
                        {item.last_seen ? (
                          <span className="request-date">
                            <b>
                              {new Date(item.last_seen).toLocaleDateString()}
                            </b>
                            <small>
                              {new Date(item.last_seen).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </small>
                          </span>
                        ) : (
                          <span className="muted-cell">Never connected</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <p className="kiosk-no-results">No kiosk matches your search.</p>
            )}
          </>
        ) : (
          <Empty
            title="No kiosk detected"
            detail="Open the student dispenser on a kiosk device. It will appear here after connecting."
          />
        )}
      </section>
      {selectedId && (
        <section className="panel kiosk-detail-panel">
          {detailsLoading || !selected ? (
            <div className="kiosk-loading" role="status">
              <span className="loading-spinner" /> Loading kiosk details...
            </div>
          ) : (
            <>
              <header>
                <div>
                  <p className="eyebrow">KIOSK DETAILS</p>
                  <h2>
                    {selected.location || "Kiosk"} — {selected.kiosk_code}
                  </h2>
                  <p>{selected.kiosk_name}</p>
                </div>
                <span
                  className={`kiosk-connection ${selected.is_online ? "online" : "offline"}`}
                >
                  <i />
                  {selected.is_online ? "Online" : "Offline"}
                </span>
              </header>
              <dl className="kiosk-detail-grid">
                <div>
                  <dt>Current usage</dt>
                  <dd>
                    <KioskUsageStatus kiosk={selected} />
                  </dd>
                </div>
                <div>
                  <dt>IP address</dt>
                  <dd>{selected.ip_address || "Not reported"}</dd>
                </div>
                <div>
                  <dt>MAC address</dt>
                  <dd>
                    {selected.mac_address || "Not available in browser kiosk"}
                  </dd>
                </div>
                <div>
                  <dt>Operating system</dt>
                  <dd>{selected.operating_system || "Not reported"}</dd>
                </div>
                <div>
                  <dt>Uptime</dt>
                  <dd>{duration(selected.uptime_seconds)}</dd>
                </div>
                <div>
                  <dt>Browser</dt>
                  <dd>{selected.browser_status || "Not reported"}</dd>
                </div>
                <div>
                  <dt>Browser status</dt>
                  <dd>{selected.is_online ? "Running" : "Not connected"}</dd>
                </div>
                <div>
                  <dt>Website</dt>
                  <dd>{selected.current_page || "Not reported"}</dd>
                </div>
                <div>
                  <dt>Website status</dt>
                  <dd>{selected.is_online ? "Reachable" : "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>
                    {selected.last_seen
                      ? new Date(selected.last_seen).toLocaleString()
                      : "Never"}
                  </dd>
                </div>
              </dl>
              <div className="kiosk-command-actions">
                <Button
                  variant="secondary"
                  onClick={() => setPendingAction("reload")}
                >
                  <AppIcon name="refresh" /> Reload dispenser
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setPendingAction("restartBrowser")}
                >
                  <AppIcon name="restart_alt" /> Restart browser
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setPendingAction("reboot")}
                >
                  <AppIcon name="restart_alt" /> Reboot
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setPendingAction("shutdown")}
                >
                  <AppIcon name="power_settings_new" /> Shut down
                </Button>
              </div>
              <div className="kiosk-command-note">
                <AppIcon name="info" size={18} /> Reload and restart run in the
                browser kiosk. Reboot and shut down require the optional device
                agent and will be reported as unsupported until it is installed.
              </div>
              {details.commands?.length > 0 && (
                <section className="kiosk-command-history">
                  <h3>Recent commands</h3>
                  {details.commands.map((command) => (
                    <div key={command.id}>
                      <span>{command.command.replace(/_/g, " ")}</span>
                      <Status
                        tone={
                          command.status === "COMPLETED"
                            ? "green"
                            : command.status === "UNSUPPORTED" ||
                                command.status === "FAILED"
                              ? "danger"
                              : "gold"
                        }
                      >
                        {command.status.toLowerCase()}
                      </Status>
                      <small>
                        {command.result_text ||
                          new Date(command.created_at).toLocaleString()}
                      </small>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </section>
      )}
      {pendingAction && (
        <ConfirmModal
          title={`${actionLabel[pendingAction]}?`}
          message={
            pendingAction === "reboot" || pendingAction === "shutdown"
              ? "This command requires a kiosk device agent. Without one, the kiosk will report the command as unsupported."
              : "The command will run on the selected kiosk as soon as it checks in."
          }
          confirmLabel={actionLabel[pendingAction]}
          onConfirm={queueAction}
          onClose={() => setPendingAction("")}
        />
      )}
    </>
  );
}

function GenericPage({ path }) {
  const [title, description, button, empty, detail] = pageMeta[path];
  const [query, setQuery] = useState("");
  const importPage = path === "/admin/imports";
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button
            onClick={() =>
              alert(`${button} workflow will be connected to the API next.`)
            }
          >
            {button}
          </Button>
        }
      />
      {importPage ? (
        <section className="import-grid">
          {[
            "Students",
            "SATP",
            "Schoology",
            "Kumosoft",
            "Institutional email",
            "WiFi vouchers",
          ].map((type) => (
            <article className="import-card" key={type}>
              <h3>{type}</h3>
              <p>
                CSV or XLSX upload with column validation and error reporting.
              </p>
              <Button
                variant="secondary"
                onClick={() => alert(`Select a ${type} file.`)}
              >
                Upload file
              </Button>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel">
          <div className="table-toolbar">
            <input
              placeholder={`Search ${title.toLowerCase()}...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select>
              <option>All records</option>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <Empty
            title={empty}
            detail={detail}
            action={
              <Button
                onClick={() =>
                  alert(`${button} workflow will be connected to the API next.`)
                }
              >
                {button}
              </Button>
            }
          />
        </section>
      )}
    </>
  );
}

function AcademicPeriodsPage({ token }) {
  const [periods, setPeriods] = useState([]);
  const [schoolYear, setSchoolYear] = useState("");
  const [semester, setSemester] = useState("First semester");
  const [editor, setEditor] = useState(null);
  const [current, setCurrent] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const load = () =>
    request("/admin/academic-periods", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((rows) => {
        setPeriods(rows);
        return rows;
      })
      .catch((err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const openCreate = () => {
    setSchoolYear("");
    setSemester("First semester");
    setCurrent(false);
    setError("");
    setEditor("create");
  };
  const openEdit = (period) => {
    setSchoolYear(period.schoolYear);
    setSemester(period.semester);
    setCurrent(period.isCurrent);
    setError("");
    setEditor(period);
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editor === "create") {
        const created = await request("/admin/academic-periods", {
          method: "POST",
          headers,
          body: JSON.stringify({ schoolYear, semester }),
        });
        if (current)
          await request(`/admin/academic-periods/${created.id}/activate`, {
            method: "PATCH",
            headers,
          });
      } else {
        await request(`/admin/academic-periods/${editor.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ schoolYear, semester, isCurrent: current }),
        });
      }
      await load();
      setEditor(null);
      window.dispatchEvent(new Event("academic-period-updated"));
      setToast({
        message: current
          ? `${schoolYear} · ${semester} is now the active academic period.`
          : `Academic period ${editor === "create" ? "created" : "updated"} successfully.`,
        tone: "success",
      });
    } catch (err) {
      setToast({
        message: err.message || "Unable to save the academic period.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Academic periods"
        description="Set the school year and term used for the current dispenser records and activity."
      />
      {error && <p className="error">{error}</p>}
      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      )}
      <section className="panel academic-period-directory">
        <header className="academic-period-directory-header">
          <div>
            <p className="eyebrow">RECORD DIRECTORY</p>
            <h2>Academic periods</h2>
          </div>
          <Button onClick={openCreate}>
            <AppIcon name="add" /> Add period
          </Button>
        </header>
        <div className="academic-period-table-tools">
          <span>Configured academic periods</span>
          <small>
            {periods.filter((period) => period.isCurrent).length
              ? "Choose Edit to change the active period."
              : "Choose Edit and mark a period current."}
          </small>
        </div>
        <div className="student-list-wrap">
          <table className="student-list-table academic-period-table">
            <thead>
              <tr>
                <th>School year</th>
                <th>Term</th>
                <th>Students</th>
                <th>Vouchers</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id}>
                  <td>
                    <b>{period.schoolYear}</b>
                  </td>
                  <td>{period.semester}</td>
                  <td>{period.studentCount}</td>
                  <td>{period.voucherCount}</td>
                  <td>
                    <Status tone={period.isCurrent ? "green" : "danger"}>
                      {period.isCurrent ? "Current" : "Historical"}
                    </Status>
                  </td>
                  <td>
                    <button
                      className="academic-period-edit"
                      onClick={() => openEdit(period)}
                      aria-label={`Edit ${period.schoolYear} ${period.semester}`}
                    >
                      <AppIcon name="edit" size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!periods.length && (
          <Empty
            title="No academic period yet"
            detail="Add the first period, then mark it current."
          />
        )}
      </section>
      {editor && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !busy && setEditor(null)}
        >
          <section
            className="student-modal academic-period-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">ACADEMIC PERIOD</p>
                <h2>{editor === "create" ? "Add period" : "Edit period"}</h2>
                <p>
                  Set the school year, term, and whether this is the current
                  period.
                </p>
              </div>
              <button
                className="modal-close"
                onClick={() => setEditor(null)}
                disabled={busy}
              >
                &times;
              </button>
            </header>
            <form className="student-form" onSubmit={save}>
              <div className="form-grid">
                <Field
                  label="School year"
                  placeholder="2026-2027"
                  value={schoolYear}
                  onChange={setSchoolYear}
                />
                <label className="field">
                  <span>Term</span>
                  <select
                    value={semester}
                    onChange={(event) => setSemester(event.target.value)}
                  >
                    <option>First semester</option>
                    <option>Second semester</option>
                    <option>Summer</option>
                    <option>First term</option>
                    <option>Second term</option>
                    <option>Third term</option>
                  </select>
                </label>
              </div>
              <label className="status-toggle">
                <span>
                  <b>Set as current period</b>
                  <small>
                    {editor !== "create" && editor.isCurrent
                      ? "This is the active period. Edit another period to replace it."
                      : "Making this current automatically moves the previous active period to historical."}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={current}
                  disabled={editor !== "create" && editor.isCurrent}
                  onChange={(event) => setCurrent(event.target.checked)}
                />
                <i />
              </label>
              {error && <p className="error">{error}</p>}
              <footer className="modal-form-footer">
                <Button
                  variant="secondary"
                  onClick={() => setEditor(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <button className="btn primary" disabled={busy}>
                  {busy ? "Saving..." : "Save period"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function AdminRedirect({ to, message }) {
  useEffect(() => {
    go(to);
  }, [to]);
  return <main className="admin-login">{message}</main>;
}

function AdminApp() {
  const { path, revision } = usePath();
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [admin, setAdmin] = useState(null);
  const [sessionNotice, setSessionNotice] = useState("");
  useEffect(() => {
    const updateToken = (event) => setToken(event.detail);
    const sessionExpired = () => {
      setToken("");
      setAdmin(null);
      setChecking(false);
      setSessionNotice("Your session has expired. Please sign in again.");
    };
    addEventListener("admin-token-refreshed", updateToken);
    addEventListener("admin-session-expired", sessionExpired);
    return () => {
      removeEventListener("admin-token-refreshed", updateToken);
      removeEventListener("admin-session-expired", sessionExpired);
    };
  }, []);
  useEffect(() => {
    let active = true;
    adminApi
      .restoreSession()
      .then((restoredToken) => {
        if (active && !restoredToken) setChecking(false);
      })
      .catch(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    request("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(({ admin: currentAdmin }) => {
        if (controller.signal.aborted) return;
        setAdmin(currentAdmin);
        setChecking(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [token]);
  if (checking)
    return (
      <main className="admin-login">
        Checking your administrator session...
      </main>
    );
  if (!token)
    return (
      <AdminLogin
        notice={sessionNotice}
        onLogin={(nextToken) => {
          setChecking(true);
          setAdmin(null);
          setSessionNotice("");
          adminApi.startSession(nextToken);
        }}
      />
    );
  const content =
    admin?.role === "Request Staff" && path !== "/admin/password-resets" ? (
      <AdminRedirect
        to="/admin/password-resets"
        message="Opening credential requests..."
      />
    ) : path === "/admin" ? (
      <Dashboard token={token} />
    ) : path === "/admin/students" ? (
      <StudentsPage token={token} />
    ) : path === "/admin/courses" ? (
      <CoursesPage token={token} />
    ) : path === "/admin/vouchers" ? (
      <VouchersPage token={token} />
    ) : path === "/admin/release-vouchers" ? (
      <ReleaseVouchersPage token={token} />
    ) : path === "/admin/imports" ? (
      <ImportsPage token={token} />
    ) : path === "/admin/password-resets" ? (
      <PasswordResetRequestsPage token={token} />
    ) : path === "/admin/reminders" ? (
      <RemindersPage token={token} />
    ) : path === "/admin/transactions" ? (
      <TransactionsPage token={token} />
    ) : path === "/admin/module-controls" ? (
      <ModuleControlsPage token={token} />
    ) : path === "/admin/kiosks" ? (
      <KiosksPage token={token} />
    ) : path === "/admin/users" ? (
      <AdminUsersPage token={token} />
    ) : path === "/admin/settings" ? (
      <AdminRedirect to="/admin" message="Opening dashboard..." />
    ) : path === "/admin/credentials" ? (
      <AdminRedirect
        to="/admin/students"
        message="Opening student records..."
      />
    ) : path === "/admin/academic-periods" ? (
      <AcademicPeriodsPage token={token} />
    ) : (
      <GenericPage path={pageMeta[path] ? path : "/admin/students"} />
    );
  return (
    <AdminShell
      path={path}
      token={token}
      admin={admin}
      onLogout={async () => {
        setChecking(true);
        await adminApi.logout().catch(() => {});
        setToken("");
        setAdmin(null);
        setSessionNotice("");
        setChecking(false);
        go("/admin");
      }}
    >
      <div className="page-transition" key={`${path}-${revision}`}>
        {content}
      </div>
    </AdminShell>
  );
}

function KioskHeader({
  mode = "Kiosk",
  subtitle = "Student WiFi & System Credentials",
}) {
  return (
    <header className="kiosk-site-header">
      <div className="kiosk-site-brand">
        <img src={ndmuLogo} alt="NDMU seal" />
        <span>
          <b>Notre Dame of Marbel University</b>
          <small>{subtitle}</small>
        </span>
      </div>
      <span className="kiosk-mode">{mode}</span>
    </header>
  );
}

function KioskFooter() {
  return (
    <footer className="kiosk-site-footer">
      <span>
        NDMU © {new Date().getFullYear()} | Developed by MIS Department
      </span>
    </footer>
  );
}

function KioskGuidelines({ guidelines, tip }) {
  const shouldMarquee = guidelines.length > 4;
  const marqueeGuidelines = shouldMarquee
    ? [...guidelines, ...guidelines]
    : guidelines;

  return (
    <section className="kiosk-card kiosk-guidelines">
      <h2>Credential &amp; Voucher Guidelines</h2>
      <div
        className={`guideline-carousel${shouldMarquee ? " is-marquee" : ""}`}
      >
        <div
          className="guideline-list"
          aria-live={shouldMarquee ? "off" : "polite"}
        >
          {marqueeGuidelines.map((item, index) => (
            <article
              key={`${item.id}-${index}`}
              aria-hidden={shouldMarquee && index >= guidelines.length}
            >
              <i />
              <p>
                <b>{item.title}</b>
                {item.message && ` ${item.message}`}
              </p>
            </article>
          ))}
          {!guidelines.length && (
            <p className="guideline-empty">
              No guidelines are currently posted.
            </p>
          )}
        </div>
      </div>
      {tip && (
        <aside>
          <b>{tip.title}</b>
          <span>{tip.message}</span>
        </aside>
      )}
    </section>
  );
}

function Kiosk() {
  const [courses, setCourses] = useState([]),
    [reminders, setReminders] = useState([]),
    [moduleControls, setModuleControls] = useState([]),
    [form, setForm] = useState({
      studentId: "",
      lastName: "",
      birthDate: "",
      courseId: "",
    }),
    [error, setError] = useState(""),
    [result, setResult] = useState(null),
    [requestingReset, setRequestingReset] = useState(""),
    [resetNotice, setResetNotice] = useState(""),
    [resetRequestInfo, setResetRequestInfo] = useState(null),
    [voucherRequestOpen, setVoucherRequestOpen] = useState(false),
    [voucherRequestReason, setVoucherRequestReason] = useState(""),
    [requestingVoucher, setRequestingVoucher] = useState(false),
    [confirmReveal, setConfirmReveal] = useState(false),
    [revealing, setRevealing] = useState(false),
    [passwordsVisible, setPasswordsVisible] = useState(false);
  const [kioskReady, setKioskReady] = useState(false);
  const kioskActivity = useRef(null);
  const reportKioskActivity = useRef(null);
  if (!kioskActivity.current)
    kioskActivity.current = createKioskActivityTracker();
  const viewingCredentials = Boolean(result);
  useEffect(() => {
    kioskActivity.current.setViewing(viewingCredentials);
    reportKioskActivity.current?.();
  }, [viewingCredentials]);
  useEffect(() => {
    let active = true;
    const start = async () => {
      try {
        await request("/kiosk/session", {
          method: "POST",
          headers: kioskHeaders,
        });
        if (!active) return;
        setKioskReady(true);
        const [loadedCourses, loadedReminders, loadedControls] =
          await Promise.all([
            request("/kiosk/courses", { headers: kioskHeaders }),
            request("/kiosk/reminders", { headers: kioskHeaders }),
            request("/kiosk/module-controls", { headers: kioskHeaders }),
          ]);
        if (!active) return;
        setCourses(loadedCourses);
        setReminders(loadedReminders);
        setModuleControls(loadedControls);
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    start();
    const loadControls = () =>
      kioskReady &&
      request("/kiosk/module-controls", { headers: kioskHeaders })
        .then(setModuleControls)
        .catch(() => {});
    const controlTimer = setInterval(loadControls, 15000);
    return () => {
      active = false;
      clearInterval(controlTimer);
    };
  }, [kioskReady]);
  useEffect(() => {
    if (!kioskReady) return undefined;
    let active = true;
    let inFlight = false;
    let queued = false;
    const completeCommand = (commandId, status, result) =>
      request("/kiosk/commands/complete", {
        method: "POST",
        headers: kioskHeaders,
        body: JSON.stringify({ commandId, status, result }),
      });
    const heartbeat = async () => {
      if (!active) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        const { commands = [] } = await request("/kiosk/heartbeat", {
          method: "POST",
          headers: kioskHeaders,
          body: JSON.stringify({
            ...kioskIdentity,
            activity: kioskActivity.current.snapshot(),
            currentPage: location.pathname,
            uptimeSeconds: Math.floor((Date.now() - KIOSK_STARTED_AT) / 1000),
            operatingSystem:
              navigator.userAgentData?.platform || navigator.platform || "",
          }),
        });
        for (const command of commands) {
          if (!active) return;
          if (["RELOAD", "RESTART_BROWSER"].includes(command.command)) {
            await completeCommand(
              command.id,
              "COMPLETED",
              "The credentials dispenser was reloaded.",
            );
            location.reload();
            return;
          }
          await completeCommand(
            command.id,
            "UNSUPPORTED",
            "This browser kiosk cannot control the device power. Install the kiosk device agent to use this action.",
          );
        }
      } catch {
      } finally {
        inFlight = false;
        if (queued && active) {
          queued = false;
          void heartbeat();
        }
      }
    };
    const trackInteraction = () => {
      if (kioskActivity.current.interact()) void heartbeat();
    };
    const refreshActivity = () => {
      if (document.visibilityState === "visible") void heartbeat();
    };
    const activityEvents = [
      "pointerdown",
      "pointermove",
      "touchstart",
      "keydown",
      "input",
      "wheel",
    ];
    activityEvents.forEach((event) =>
      window.addEventListener(event, trackInteraction, { passive: true }),
    );
    document.addEventListener("visibilitychange", refreshActivity);
    reportKioskActivity.current = heartbeat;
    heartbeat();
    const timer = setInterval(heartbeat, 5000);
    return () => {
      active = false;
      clearInterval(timer);
      reportKioskActivity.current = null;
      activityEvents.forEach((event) =>
        window.removeEventListener(event, trackInteraction),
      );
      document.removeEventListener("visibilitychange", refreshActivity);
    };
  }, [kioskReady]);
  useEffect(() => {
    if (!resetNotice) return;
    const timer = setTimeout(() => setResetNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [resetNotice]);
  useEffect(() => {
    if (!result) return undefined;
    let timer;
    const closeSummary = () => {
      setResult(null);
      setForm({ studentId: "", lastName: "", birthDate: "", courseId: "" });
      setPasswordsVisible(false);
      setResetNotice("");
      setResetRequestInfo(null);
      setVoucherRequestOpen(false);
      setVoucherRequestReason("");
      setConfirmReveal(false);
    };
    const restartTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(closeSummary, 30_000);
    };
    const activityEvents = [
      "pointerdown",
      "pointermove",
      "touchstart",
      "keydown",
      "wheel",
    ];
    activityEvents.forEach((event) =>
      window.addEventListener(event, restartTimer),
    );
    restartTimer();
    return () => {
      clearTimeout(timer);
      activityEvents.forEach((event) =>
        window.removeEventListener(event, restartTimer),
      );
    };
  }, [result]);
  const verify = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.courseId)
      return setError("Search for and select your course from the list.");
    try {
      const checked = await request("/kiosk/verify", {
        method: "POST",
        headers: kioskHeaders,
        body: JSON.stringify(form),
      });
      const credentials = await request("/kiosk/credentials", {
        headers: { ...kioskHeaders, Authorization: `Bearer ${checked.token}` },
      });
      setResult({ ...credentials, sessionToken: checked.token });
    } catch (err) {
      setError(err.message);
    }
  };
  const requestIsPending = (credentialType, kind) =>
    Boolean(
      result?.pendingRequests?.some(
        (item) => item.type === credentialType && item.kind === kind,
      ),
    );
  const pendingRequest = (credentialType, kind) =>
    result?.pendingRequests?.find(
      (item) => item.type === credentialType && item.kind === kind,
    );
  const formatRequestTime = (value) => {
    if (!value) return "recently";
    const raw = String(value);
    const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
    const date = new Date(hasOffset ? raw : `${raw.replace(" ", "T")}+08:00`);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  };
  const requestOutcome = (credentialType, kind) =>
    result?.requestOutcomes?.find(
      (item) => item.type === credentialType && item.kind === kind,
    );
  const requestOutcomeMessage = (outcome) => {
    if (!outcome) return "";
    const date = formatRequestTime(outcome.resolvedAt);
    if (outcome.kind === "VOUCHER_REQUEST")
      return outcome.status === "REJECTED"
        ? `Voucher request was rejected on ${date}.`
        : `Voucher request was approved on ${date}.`;
    return outcome.kind === "ACCOUNT_CREATION"
      ? `Account request was approved on ${date}.`
      : `Password reset request was completed on ${date}.`;
  };
  const markRequestPending = (credentialType, kind) =>
    setResult((current) => {
      const pendingRequests = current.pendingRequests || [];
      return pendingRequests.some(
        (item) => item.type === credentialType && item.kind === kind,
      )
        ? current
        : {
            ...current,
            pendingRequests: [
              ...pendingRequests,
              {
                type: credentialType,
                kind,
                requestedAt: new Date().toISOString(),
              },
            ],
          };
    });
  const acceptsRequest = (credentialType, kind) => {
    const control = moduleControls.find(
      (item) => item.module_key === credentialType,
    );
    if (control && (!control.is_visible || control.is_maintenance))
      return false;
    const options = credentialRequestOptions(credentialType, control);
    if (kind === "ACCOUNT_CREATION") return options.accountRequests;
    return options.passwordResets;
  };
  useEffect(() => {
    if (
      resetRequestInfo &&
      !requestingReset &&
      !acceptsRequest(resetRequestInfo.type, resetRequestInfo.kind)
    ) {
      setResetRequestInfo(null);
      setResetNotice("Requests for this account are currently unavailable.");
    }
  }, [moduleControls, resetRequestInfo, requestingReset]);
  const requestReset = async (credentialType) => {
    if (!acceptsRequest(credentialType, "PASSWORD_RESET"))
      return setResetNotice(
        "Password reset requests for this account are currently unavailable.",
      );
    setRequestingReset(credentialType);
    setResetNotice("");
    try {
      await request("/kiosk/password-reset-requests", {
        method: "POST",
        headers: {
          ...kioskHeaders,
          Authorization: `Bearer ${result.sessionToken}`,
        },
        body: JSON.stringify({ credentialType }),
      });
      setResetNotice(
        `Your ${resetRequestInfo.title} password reset request is pending. ${resetRequestInfo.followUp}`,
      );
      markRequestPending(credentialType, "PASSWORD_RESET");
      setResetRequestInfo(null);
    } catch (err) {
      setResetNotice(err.message);
    } finally {
      setRequestingReset("");
    }
  };
  const requestAccount = async (credentialType) => {
    if (!acceptsRequest(credentialType, "ACCOUNT_CREATION"))
      return setResetNotice(
        "New-account requests for this credential are currently unavailable.",
      );
    setRequestingReset(credentialType);
    setResetNotice("");
    try {
      await request("/kiosk/account-requests", {
        method: "POST",
        headers: {
          ...kioskHeaders,
          Authorization: `Bearer ${result.sessionToken}`,
        },
        body: JSON.stringify({ credentialType }),
      });
      setResetNotice(
        `Your ${resetRequestInfo.title} account request is pending. ${ACCOUNT_REQUEST_FOLLOW_UP}`,
      );
      markRequestPending(credentialType, "ACCOUNT_CREATION");
      setResetRequestInfo(null);
    } catch (err) {
      setResetNotice(err.message);
    } finally {
      setRequestingReset("");
    }
  };
  const requestNewVoucher = async () => {
    setRequestingVoucher(true);
    setResetNotice("");
    try {
      const response = await request("/kiosk/voucher-requests", {
        method: "POST",
        headers: {
          ...kioskHeaders,
          Authorization: `Bearer ${result.sessionToken}`,
        },
        body: JSON.stringify({ reason: voucherRequestReason }),
      });
      setResetNotice(response.message);
      markRequestPending("VOUCHER", "VOUCHER_REQUEST");
      setVoucherRequestOpen(false);
      setVoucherRequestReason("");
    } catch (err) {
      setResetNotice(err.message);
    } finally {
      setRequestingVoucher(false);
    }
  };
  const revealPasswords = async () => {
    setConfirmReveal(false);
    setRevealing(true);
    setResetNotice("");
    try {
      const response = await request("/kiosk/credentials/reveal", {
        method: "POST",
        headers: {
          ...kioskHeaders,
          Authorization: `Bearer ${result.sessionToken}`,
        },
      });
      setResult({
        ...result,
        credentials: result.credentials.map((credential) => ({
          ...credential,
          ...(response.credentials.find(
            (item) => item.type === credential.type,
          ) || {}),
        })),
        wifiVoucher: response.wifiVoucher,
      });
      setPasswordsVisible(true);
    } catch (err) {
      setResetNotice(err.message);
    } finally {
      setRevealing(false);
    }
  };
  const banner = reminders.find((item) => item.placement === "BANNER"),
    guidelines = reminders.filter((item) => item.placement === "GUIDELINE"),
    tip = reminders.find((item) => item.placement === "TIP"),
    accountMeta = {
      EMAIL: {
        title: "Email",
        username: "Email",
        website: "Google Workspace / Gmail",
      },
      KUMOSOFT: {
        title: "Kumosoft",
        username: "Kumosoft ID",
        website: "sms.ndmu.edu.ph",
      },
      SCHOOLOGY: {
        title: "Schoology",
        username: "Username",
        website: "ndmu.schoology.com",
      },
      SATP: {
        title: "SATP",
        username: "Username",
        website: "satp.ndmu.edu.ph",
      },
    },
    visibleCredentials = [...(result?.credentials || [])].sort((a, b) => {
      const stateRank = (item) =>
        item.unavailable ? 2 : item.maintenance ? 1 : 0;
      const stateDifference = stateRank(a) - stateRank(b);
      return (
        stateDifference ||
        ["EMAIL", "KUMOSOFT", "SCHOOLOGY", "SATP"].indexOf(a.type) -
          ["EMAIL", "KUMOSOFT", "SCHOOLOGY", "SATP"].indexOf(b.type)
      );
    }),
    availableCredentialCount = visibleCredentials.filter(
      (item) => !item.unavailable && !item.maintenance,
    ).length,
    kioskControl = moduleControls.find((item) => item.module_key === "KIOSK"),
    passwordResetRequestsEnabled = visibleCredentials.some(
      (item) =>
        !item.unavailable &&
        !item.maintenance &&
        acceptsRequest(item.type, "PASSWORD_RESET"),
    );
  if (kioskControl?.is_maintenance)
    return (
      <div className="kiosk-page">
        <KioskHeader />
        <main className="kiosk-maintenance">
          <span className="maintenance-icon">
            <AppIcon name="settings" size={34} />
          </span>
          <p className="eyebrow">TEMPORARILY UNAVAILABLE</p>
          <h1>Dispenser under maintenance</h1>
          <p>
            The student credentials dispenser is temporarily unavailable. Please
            try again later.
          </p>
          <button className="btn secondary" onClick={() => location.reload()}>
            Check again
          </button>
        </main>
        <KioskFooter />
      </div>
    );
  if (result)
    return (
      <div className="kiosk-page">
        <KioskHeader />
        <main
          key="credentials-summary"
          className="kiosk kiosk-results kiosk-view kiosk-view-summary"
        >
          <header className="credentials-summary-heading">
            <h1>Credentials Summary</h1>
            <p>
              {availableCredentialCount} of {visibleCredentials.length} account
              {visibleCredentials.length === 1 ? "" : "s"} available · Passwords
              are hidden until you tap <b>Show All</b>.
            </p>
            <p className="credentials-summary-guidance">
              Email, Schoology, and Kumosoft passwords shown here are default
              passwords.
              {passwordResetRequestsEnabled && (
                <>
                  {" "}
                  Forgot your password? Tap Request password reset on the
                  account below.
                </>
              )}
            </p>
          </header>
          <section className="credential-summary-panel">
            <div>
              <h2>{result.student.fullName}</h2>
              <p>
                <b>Course:</b> {result.student.course}
              </p>
              <p>
                <b>Student ID:</b> {result.student.studentId}
              </p>
              {result.voucherState !== "HIDDEN" && (
                <div>
                  <p className="voucher-summary">
                    <b>WiFi Voucher</b>
                    <code>
                      {result.voucherState === "MAINTENANCE"
                        ? "Under maintenance"
                        : passwordsVisible
                          ? result.wifiVoucher || "Pending"
                          : result.hasWifiVoucher
                            ? "••••••••"
                            : "Pending"}
                    </code>
                    {result.voucherState === "AVAILABLE" && (
                      <button
                        type="button"
                        className={`voucher-request-button kiosk-request-button${requestIsPending("VOUCHER", "VOUCHER_REQUEST") ? " pending" : ""}`}
                        disabled={requestIsPending(
                          "VOUCHER",
                          "VOUCHER_REQUEST",
                        )}
                        onClick={() => setVoucherRequestOpen(true)}
                      >
                        <AppIcon
                          name={
                            requestIsPending("VOUCHER", "VOUCHER_REQUEST")
                              ? "check_circle"
                              : "confirmation_number"
                          }
                          size={18}
                        />
                        <span className="request-action-label">
                          {requestIsPending("VOUCHER", "VOUCHER_REQUEST")
                            ? "New voucher request pending"
                            : "Request new voucher"}
                        </span>
                      </button>
                    )}
                  </p>
                  {requestOutcome("VOUCHER", "VOUCHER_REQUEST") && (
                    <p
                      className={`credential-request-outcome ${requestOutcome("VOUCHER", "VOUCHER_REQUEST").status.toLowerCase()}`}
                    >
                      {requestOutcomeMessage(
                        requestOutcome("VOUCHER", "VOUCHER_REQUEST"),
                      )}
                    </p>
                  )}
                  {pendingRequest("VOUCHER", "VOUCHER_REQUEST") && (
                    <p className="credential-request-outcome pending">
                      Voucher request submitted on{" "}
                      {formatRequestTime(
                        pendingRequest("VOUCHER", "VOUCHER_REQUEST")
                          .requestedAt,
                      )}
                      .
                    </p>
                  )}
                </div>
              )}
            </div>
            <p>
              <b>Tip:</b> Keep this screen private. It clears after 30 seconds
              of inactivity.
            </p>
          </section>
          <section className="credential-grid credential-summary-grid">
            {visibleCredentials.map((c) => {
              const meta = accountMeta[c.type] || {
                title: c.type,
                username: "Username",
                website: "",
              };
              const outcome = requestOutcome(
                c.type,
                c.unavailable ? "ACCOUNT_CREATION" : "PASSWORD_RESET",
              );
              const pending = pendingRequest(
                c.type,
                c.unavailable ? "ACCOUNT_CREATION" : "PASSWORD_RESET",
              );
              const canRequest =
                !c.maintenance &&
                acceptsRequest(
                  c.type,
                  c.unavailable ? "ACCOUNT_CREATION" : "PASSWORD_RESET",
                );
              const supportsGoogleSignIn = ["SATP", "KUMOSOFT"].includes(
                c.type,
              );
              const showGoogleSignIn =
                supportsGoogleSignIn &&
                (c.unavailable ||
                  c.hasPassword === false ||
                  (passwordsVisible && !c.password?.trim()) ||
                  (c.type === "KUMOSOFT" &&
                    passwordResetGuidance(c).checkForNewPassword));
              const googleSignIn = (
                <p className="credential-google-sign-in">
                  Use <b>Sign in with Google</b> with your institutional email
                  account.
                </p>
              );
              return (
                <article
                  className="credential credential-summary-card"
                  key={c.type}
                >
                  <h2>
                    <span>{meta.title}</span>
                    <Status
                      tone={c.unavailable || c.maintenance ? "gold" : "green"}
                    >
                      {c.unavailable
                        ? "Not assigned"
                        : c.maintenance
                          ? "Maintenance"
                          : "Available"}
                    </Status>
                  </h2>
                  {c.maintenance ? (
                    <div className="credential-module-maintenance">
                      <b>Temporarily unavailable</b>
                      <span>
                        The MIS administrator has placed this account under
                        maintenance.
                      </span>
                    </div>
                  ) : c.unavailable && supportsGoogleSignIn ? (
                    <div className="credential-module-unavailable">
                      {googleSignIn}
                      <p className="credential-website">
                        <b>Website:</b> {meta.website}
                      </p>
                    </div>
                  ) : c.unavailable ? (
                    <div className="credential-module-unavailable">
                      <b>Account required</b>
                      <span>
                        No {meta.title} account is linked to this student.
                      </span>
                    </div>
                  ) : (
                    <div className="credential-card-body">
                      <p>
                        <b>{meta.username}:</b> <span>{c.username}</span>
                      </p>
                      {showGoogleSignIn ? (
                        googleSignIn
                      ) : (
                        <p
                          className={`credential-password${passwordsVisible ? " visible" : ""}`}
                        >
                          <b>Password:</b>
                          <code>
                            {passwordsVisible
                              ? (c.password ?? "Not provided")
                              : "••••••••"}
                          </code>
                        </p>
                      )}
                      {meta.website && (
                        <p className="credential-website">
                          <b>Website:</b> {meta.website}
                        </p>
                      )}
                    </div>
                  )}
                  {canRequest || outcome || pending ? (
                    <div className="credential-request-row">
                      {canRequest && (
                        <button
                          type="button"
                          className={`credential-reset-button kiosk-request-button${pending ? " pending" : ""}`}
                          disabled={
                            Boolean(requestingReset) || Boolean(pending)
                          }
                          onClick={() =>
                            setResetRequestInfo({
                              type: c.type,
                              title: meta.title,
                              kind: c.unavailable
                                ? "ACCOUNT_CREATION"
                                : "PASSWORD_RESET",
                              ...passwordResetGuidance(c),
                            })
                          }
                        >
                          <AppIcon
                            name={
                              pending
                                ? "check_circle"
                                : c.unavailable
                                  ? "person_add"
                                  : "lock_reset"
                            }
                            size={18}
                          />
                          <span className="request-action-label">
                            {pending
                              ? c.unavailable
                                ? "Request pending"
                                : "Reset request pending"
                              : requestingReset === c.type
                                ? "Submitting..."
                                : c.unavailable
                                  ? "Request account"
                                  : "Request password reset"}
                          </span>
                        </button>
                      )}
                      {outcome && !pending && (
                        <p
                          className={`credential-request-outcome ${outcome.status.toLowerCase()}`}
                        >
                          {requestOutcomeMessage(outcome)}
                        </p>
                      )}
                      {pending && (
                        <p className="credential-request-outcome pending">
                          Request submitted on{" "}
                          {formatRequestTime(pending.requestedAt)}.
                          {pending.kind === "PASSWORD_RESET" &&
                            ` ${passwordResetGuidance(c).followUp}`}
                          {pending.kind === "ACCOUNT_CREATION" &&
                            ` ${ACCOUNT_REQUEST_FOLLOW_UP}`}
                        </p>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
          <div className="credential-summary-actions">
            {!passwordsVisible ? (
              <button
                type="button"
                className="btn reveal-all-button"
                disabled={revealing}
                onClick={() => setConfirmReveal(true)}
              >
                <AppIcon name="visibility" />
                {revealing ? "Showing..." : "Show All"}
              </button>
            ) : (
              <button
                type="button"
                className="btn reveal-all-button"
                onClick={() => {
                  setResult({
                    ...result,
                    credentials: result.credentials.map(
                      ({ password: _password, ...credential }) => credential,
                    ),
                    wifiVoucher: null,
                  });
                  setPasswordsVisible(false);
                }}
              >
                <AppIcon name="visibility_off" />
                Hide All
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setResult(null);
                setForm({
                  studentId: "",
                  lastName: "",
                  birthDate: "",
                  courseId: "",
                });
                setError("");
                setPasswordsVisible(false);
                setResetNotice("");
              }}
            >
              <AppIcon name="check" />
              Done
            </button>
          </div>
        </main>
        <KioskFooter />
        {resetNotice && (
          <Toast message={resetNotice} onClose={() => setResetNotice("")} />
        )}
        {resetRequestInfo && (
          <CredentialRequestInfoModal
            accountTitle={resetRequestInfo.title}
            requestKind={resetRequestInfo.kind}
            hasDefaultPassword={resetRequestInfo.hasDefaultPassword}
            checkForNewPassword={resetRequestInfo.checkForNewPassword}
            submitting={requestingReset === resetRequestInfo.type}
            onSubmit={() =>
              resetRequestInfo.kind === "ACCOUNT_CREATION"
                ? requestAccount(resetRequestInfo.type)
                : requestReset(resetRequestInfo.type)
            }
            onClose={() => setResetRequestInfo(null)}
          />
        )}
        {voucherRequestOpen && (
          <VoucherRequestModal
            reason={voucherRequestReason}
            submitting={requestingVoucher}
            onReasonChange={setVoucherRequestReason}
            onSubmit={requestNewVoucher}
            onClose={() => {
              setVoucherRequestOpen(false);
              setVoucherRequestReason("");
            }}
          />
        )}
        {confirmReveal && (
          <ConfirmModal
            title="Show all passwords?"
            message="The passwords will be displayed on screen and this event will be recorded in Transactions. Make sure no one else can see the kiosk."
            confirmLabel="Show passwords"
            onConfirm={revealPasswords}
            onClose={() => setConfirmReveal(false)}
          />
        )}
      </div>
    );
  return (
    <div className="kiosk-page">
      <KioskHeader />
      <main
        key="credentials-dispenser"
        className="kiosk kiosk-landing kiosk-view kiosk-view-dispenser"
      >
        <header className="kiosk-hero">
          <h1>Student Credentials Dispenser</h1>
          <p>Enter your details to view your WiFi and system credentials.</p>
        </header>
        {banner && (
          <section className="kiosk-reminder-banner">
            <div>
              <span>Quick reminder</span>
              <b>{banner.title}</b>
              <small>{banner.message}</small>
            </div>
            <em>Private kiosk · Do not share your credentials.</em>
          </section>
        )}
        <div className="kiosk-content-grid">
          <section className="kiosk-card kiosk-form-card">
            <h2>Student information</h2>
            <form onSubmit={verify}>
              <div className="accepted-id">
                <b>Accepted ID</b>
                <span>You may enter either your School ID or Kumosoft ID.</span>
              </div>
              <KioskCourseSelect
                courses={courses}
                value={form.courseId}
                onChange={(courseId) => setForm({ ...form, courseId })}
              />
              <Field
                label="School ID / Kumosoft ID"
                value={form.studentId}
                onChange={(v) => setForm({ ...form, studentId: v })}
              />
              <div className="kiosk-name-date">
                <Field
                  label="Last name"
                  value={form.lastName}
                  onChange={(v) => setForm({ ...form, lastName: v })}
                />
                <Field
                  label="Birthday"
                  type="date"
                  value={form.birthDate}
                  onChange={(v) => setForm({ ...form, birthDate: v })}
                />
              </div>
              <div className="kiosk-form-actions">
                <button className="btn primary">Submit</button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    setForm({
                      studentId: "",
                      lastName: "",
                      birthDate: "",
                      courseId: "",
                    });
                    setError("");
                  }}
                >
                  Clear
                </button>
              </div>
            </form>
          </section>
          <KioskGuidelines guidelines={guidelines} tip={tip} />
        </div>
      </main>
      <KioskFooter />
      {error && (
        <Toast message={error} tone="error" onClose={() => setError("")} />
      )}
    </div>
  );
}
function ModuleControlsPage({ token }) {
  const [controls, setControls] = useState([]),
    [busy, setBusy] = useState(""),
    [pendingChange, setPendingChange] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const load = () =>
    request("/admin/module-controls", { headers })
      .then(setControls)
      .catch((err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const update = async (item, values, action) => {
    setBusy(`${item.module_key}-${action}`);
    setError("");
    try {
      const response = await request(
        `/admin/module-controls/${item.module_key}`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      setToast(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };
  const displayName = (key) =>
    key === "VOUCHER"
      ? "WiFi Voucher"
      : key === "SATP"
        ? "SATP"
        : key.charAt(0) + key.slice(1).toLowerCase();
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Credential controls"
        description="Manage credential visibility, maintenance, and which requests students can submit."
      />
      <section className="panel module-control-panel">
        <div className="course-intro">
          Disabling a credential removes it from the kiosk. Setting Kiosk
          maintenance replaces the entire dispenser with a maintenance screen.{" "}
          Pausing requests does not remove requests that are already pending.
        </div>
        {error && <p className="error">{error}</p>}
        <div className="module-control-table-wrap">
          <table className="module-control-table">
            <thead>
              <tr>
                <th>Credential section</th>
                <th>Visibility</th>
                <th>Maintenance</th>
                <th>Password resets</th>
                <th>New accounts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {controls
                .filter((item) => item.module_key !== "PASSWORD_RESET_REQUEST")
                .map((item) => {
                  const options = credentialRequestOptions(
                    item.module_key,
                    item,
                  );
                  return (
                    <tr key={item.module_key}>
                      <td>
                        <b>{displayName(item.module_key)}</b>
                        {item.module_key === "KIOSK" && (
                          <small>Controls the complete student dispenser</small>
                        )}
                        {item.module_key === "SATP" && (
                          <small>Uses Google sign-in; no request buttons</small>
                        )}
                      </td>
                      <td>
                        {item.module_key === "KIOSK" ? (
                          <span className="muted-cell">
                            Controlled by maintenance
                          </span>
                        ) : (
                          <Status tone={item.is_visible ? "green" : "gold"}>
                            {item.is_visible ? "Enabled" : "Disabled"}
                          </Status>
                        )}
                      </td>
                      <td>
                        <Status tone={item.is_maintenance ? "gold" : "green"}>
                          {item.is_maintenance ? "Maintenance" : "Normal"}
                        </Status>
                      </td>
                      <td>
                        {PASSWORD_RESET_MODULES.includes(item.module_key) ? (
                          <button
                            type="button"
                            role="switch"
                            aria-label={`Accept ${displayName(item.module_key)} password reset requests`}
                            aria-checked={options.passwordResets}
                            className="module-request-toggle"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              update(
                                item,
                                {
                                  acceptPasswordResets: !options.passwordResets,
                                },
                                "password-resets",
                              )
                            }
                          >
                            <i aria-hidden="true" />
                            <span>
                              {busy === `${item.module_key}-password-resets`
                                ? "Saving..."
                                : options.passwordResets
                                  ? "Accepting"
                                  : "Paused"}
                            </span>
                          </button>
                        ) : (
                          <span className="muted-cell">Not applicable</span>
                        )}
                      </td>
                      <td>
                        {ACCOUNT_REQUEST_MODULES.includes(item.module_key) ? (
                          <button
                            type="button"
                            role="switch"
                            aria-label={`Accept ${displayName(item.module_key)} new-account requests`}
                            aria-checked={options.accountRequests}
                            className="module-request-toggle"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              update(
                                item,
                                {
                                  acceptAccountRequests:
                                    !options.accountRequests,
                                },
                                "account-requests",
                              )
                            }
                          >
                            <i aria-hidden="true" />
                            <span>
                              {busy === `${item.module_key}-account-requests`
                                ? "Saving..."
                                : options.accountRequests
                                  ? "Accepting"
                                  : "Paused"}
                            </span>
                          </button>
                        ) : (
                          <span className="muted-cell">Not applicable</span>
                        )}
                      </td>
                      <td>
                        <div className="module-control-actions">
                          {item.module_key !== "KIOSK" && (
                            <button
                              className={`btn ${item.is_visible ? "danger" : "primary"}`}
                              disabled={Boolean(busy)}
                              onClick={() =>
                                setPendingChange({
                                  item,
                                  values: { isVisible: !item.is_visible },
                                  action: "visibility",
                                })
                              }
                            >
                              {busy === `${item.module_key}-visibility`
                                ? "Saving..."
                                : item.is_visible
                                  ? "Disable"
                                  : "Enable"}
                            </button>
                          )}
                          <button
                            className={`btn ${item.is_maintenance ? "secondary" : "maintenance"}`}
                            disabled={Boolean(busy)}
                            onClick={() =>
                              setPendingChange({
                                item,
                                values: { isMaintenance: !item.is_maintenance },
                                action: "maintenance",
                              })
                            }
                          >
                            {busy === `${item.module_key}-maintenance`
                              ? "Saving..."
                              : item.is_maintenance
                                ? "Set normal"
                                : "Set maintenance"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
      {pendingChange && (
        <ConfirmModal
          title={`${pendingChange.action === "visibility" ? (pendingChange.values.isVisible ? "Enable" : "Disable") : pendingChange.values.isMaintenance ? "Enable maintenance" : "Set normal operation"} ${displayName(pendingChange.item.module_key)}?`}
          message={
            pendingChange.action === "visibility"
              ? `${pendingChange.values.isVisible ? "Students will be able to see this credential again." : "This credential will be hidden from students at the kiosk."}`
              : pendingChange.values.isMaintenance
                ? "Students will see a maintenance notice for this module until you return it to normal operation."
                : "This module will return to normal kiosk operation."
          }
          confirmLabel="Confirm change"
          onClose={() => setPendingChange(null)}
          onConfirm={() => {
            const change = pendingChange;
            setPendingChange(null);
            update(change.item, change.values, change.action);
          }}
        />
      )}
    </>
  );
}

function TransactionsPage({ token }) {
  const [listing, setListing] = useState({
      rows: [],
      total: 0,
      today: 0,
      studentsServed: 0,
      pages: 1,
    }),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(25),
    [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [periods, setPeriods] = useState([]),
    [periodId, setPeriodId] = useState(""),
    [periodsLoading, setPeriodsLoading] = useState(true),
    [periodError, setPeriodError] = useState(""),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  const transactions = listing.rows;
  const currentPeriod = periods.find((period) => period.isCurrent);
  const periodQuery = periodId
    ? `academicPeriodId=${encodeURIComponent(periodId)}`
    : "";
  useEffect(() => {
    const term = search.trim().replace(/\s+/g, " ");
    if (term === appliedSearch) return;
    const timer = setTimeout(() => {
      setAppliedSearch(term);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);
  useEffect(() => {
    const controller = new AbortController();
    setPeriodsLoading(true);
    request("/admin/transactions/academic-periods", {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((next) => {
        if (!controller.signal.aborted) {
          setPeriods(next);
          setPeriodError("");
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setPeriodError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPeriodsLoading(false);
      });
    return () => controller.abort();
  }, [token]);

  const exportWorkbook = async () => {
    setExporting(true);
    setExportError("");
    try {
      const response = await adminFetch(
        `/admin/transactions/export${periodQuery ? `?${periodQuery}` : ""}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        let message = "Unable to export transactions. Please try again.";
        try {
          message = (await response.json()).message || message;
        } catch {}
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || "transactions.xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  };
  useEffect(() => {
    setLoading(true);
    const controller = new AbortController();
    let loading = false;
    let lastSnapshot = "";
    const refresh = async () => {
      if (
        controller.signal.aborted ||
        loading ||
        document.visibilityState === "hidden"
      )
        return;
      loading = true;
      try {
        const next = await request(
          `/admin/transactions?page=${page}&limit=${limit}${periodQuery ? `&${periodQuery}` : ""}${appliedSearch ? `&search=${encodeURIComponent(appliedSearch)}` : ""}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        const snapshot = JSON.stringify(next);
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          setListing(next);
          if (next.page !== page) setPage(next.page);
        }
        setError("");
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        loading = false;
      }
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [token, page, limit, periodQuery, appliedSearch]);
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Review when student passwords were revealed at a kiosk."
      />
      <section className="student-summary transaction-summary">
        <article>
          <span>{appliedSearch ? "Matching reveals" : "Total reveals"}</span>
          <strong>{listing.total}</strong>
        </article>
        <article>
          <span>
            {appliedSearch ? "Matching reveals today" : "Reveals today"}
          </span>
          <strong>{listing.today}</strong>
        </article>
        <article>
          <span>Students served</span>
          <strong>{listing.studentsServed}</strong>
        </article>
      </section>
      <section className="panel transactions-panel">
        <div className="course-intro">
          A password reveal is recorded only after the student confirms Show all
          passwords.
        </div>
        <div className="records-table-toolbar transaction-export-toolbar">
          <div className="transaction-table-filters">
            <label className="records-table-field">
              Academic period
              <select
                aria-label="Transaction academic period"
                value={periodId}
                disabled={periodsLoading || exporting}
                onChange={(event) => {
                  setPeriodId(event.target.value);
                  setPage(1);
                  setListing({
                    rows: [],
                    total: 0,
                    today: 0,
                    studentsServed: 0,
                    pages: 1,
                  });
                  setLoading(true);
                  setError("");
                  setExportError("");
                }}
              >
                <option value="">
                  {currentPeriod
                    ? `${currentPeriod.schoolYear} · ${currentPeriod.semester} (Current)`
                    : "Current academic period"}
                </option>
                {periods
                  .filter((period) => !period.isCurrent)
                  .map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.schoolYear} · {period.semester}
                    </option>
                  ))}
              </select>
            </label>
            <label className="records-table-field records-table-search">
              <span>Search transactions</span>
              <span className="records-table-search-input">
                <AppIcon name="search" size={18} />
                <input
                  type="search"
                  aria-label="Search transactions"
                  placeholder="Search all columns"
                  maxLength={200}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>
          </div>
          <div className="transaction-export-actions">
            <span>Export includes all rows in this academic period.</span>
            <Button onClick={exportWorkbook} disabled={exporting || loading}>
              <AppIcon name="download" />{" "}
              {exporting ? "Exporting..." : "Export Excel"}
            </Button>
          </div>
        </div>
        {periodError && (
          <p className="error" role="alert">
            Unable to load academic periods: {periodError}
          </p>
        )}
        {exportError && (
          <p className="error" role="alert">
            {exportError}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {loading && (
          <p className="loading-row" role="status">
            Loading transactions...
          </p>
        )}
        {transactions.length ? (
          <div className="reset-request-table-wrap">
            <table className="reset-request-table transactions-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Kiosk</th>
                  <th>Result</th>
                  <th>Date and time</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.student_id ? (
                        <span className="student-cell">
                          <b>
                            {[item.first_name, item.middle_name, item.last_name]
                              .filter(Boolean)
                              .join(" ")}
                          </b>
                          <small>
                            {[item.student_id, item.course_code]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      ) : (
                        <span className="muted-cell">Unknown student</span>
                      )}
                    </td>
                    <td>{item.kiosk_code || "—"}</td>
                    <td>
                      <Status tone="green">Revealed</Status>
                    </td>
                    <td>{new Date(item.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading && !error ? (
          <Empty
            title={
              appliedSearch
                ? "No matching transactions"
                : "No password reveals yet"
            }
            detail={
              appliedSearch
                ? "Try another search term or choose another academic period."
                : "There are no recorded password reveals for this academic period."
            }
          />
        ) : null}
        <footer className="student-list-pagination">
          <span>
            Showing {transactions.length ? (page - 1) * limit + 1 : 0}
            {" - "}
            {Math.min(page * limit, listing.total)} of {listing.total}{" "}
            transactions
          </span>
          <div>
            <select
              aria-label="Transactions per page"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
            <button
              aria-label="First page"
              onClick={() => setPage(1)}
              disabled={loading || page === 1}
            >
              First
            </button>
            <button
              aria-label="Previous page"
              onClick={() => setPage(page - 1)}
              disabled={loading || page === 1}
            >
              Previous
            </button>
            <label>
              Page{" "}
              <input
                type="number"
                aria-label="Page number"
                min="1"
                max={listing.pages}
                value={page}
                onChange={(event) =>
                  setPage(
                    Math.min(
                      listing.pages,
                      Math.max(1, Number(event.target.value) || 1),
                    ),
                  )
                }
              />{" "}
              of {listing.pages}
            </label>
            <button
              aria-label="Next page"
              onClick={() => setPage(page + 1)}
              disabled={loading || page >= listing.pages}
            >
              Next
            </button>
            <button
              aria-label="Last page"
              onClick={() => setPage(listing.pages)}
              disabled={loading || page >= listing.pages}
            >
              Last
            </button>
          </div>
        </footer>
      </section>
    </>
  );
}

function RemindersPage({ token }) {
  const emptyForm = {
    placement: "GUIDELINE",
    title: "",
    message: "",
    sortOrder: 10,
    isActive: true,
  };
  const [reminders, setReminders] = useState([]),
    [editor, setEditor] = useState(null),
    [confirm, setConfirm] = useState(false),
    [form, setForm] = useState(emptyForm),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const load = () =>
    request("/admin/reminders", { headers })
      .then(setReminders)
      .catch((err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const openEditor = (item = null) => {
    setConfirm(false);
    setForm(
      item
        ? {
            placement: item.placement,
            title: item.title,
            message: item.message || "",
            sortOrder: item.sort_order,
            isActive: Boolean(item.is_active),
          }
        : { ...emptyForm, sortOrder: (reminders.at(-1)?.sort_order || 0) + 10 },
    );
    setError("");
    setEditor(item || {});
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await request(
        editor.id ? `/admin/reminders/${editor.id}` : "/admin/reminders",
        {
          method: editor.id ? "PATCH" : "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, sortOrder: Number(form.sortOrder) }),
        },
      );
      setEditor(null);
      setToast(response.message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Kiosk reminders"
        description="Manage the reminders and guidance displayed on the student kiosk."
        actions={<Button onClick={() => openEditor()}>Add reminder</Button>}
      />
      <section className="student-summary reset-request-summary">
        <article>
          <span>Total reminders</span>
          <strong>{reminders.length}</strong>
        </article>
        <article>
          <span>Visible on kiosk</span>
          <strong>{reminders.filter((item) => item.is_active).length}</strong>
        </article>
        <article>
          <span>Hidden reminders</span>
          <strong>{reminders.filter((item) => !item.is_active).length}</strong>
        </article>
      </section>
      <section className="panel reminder-admin-panel">
        <div className="course-intro">
          Lower order numbers appear first. Banner and tip placements use the
          first active reminder in their group.
        </div>
        {error && !editor && <p className="error">{error}</p>}
        {reminders.length ? (
          <div className="reset-request-table-wrap">
            <table className="reset-request-table reminder-admin-table">
              <thead>
                <tr>
                  <th>Reminder</th>
                  <th>Placement</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reminders.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="student-cell">
                        <b>{item.title}</b>
                        <small>{item.message || "No supporting text"}</small>
                      </span>
                    </td>
                    <td>
                      {item.placement.charAt(0) +
                        item.placement.slice(1).toLowerCase()}
                    </td>
                    <td>{item.sort_order}</td>
                    <td>
                      <Status tone={item.is_active ? "green" : "gold"}>
                        {item.is_active ? "Visible" : "Hidden"}
                      </Status>
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => openEditor(item)}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No kiosk reminders"
            detail="Add a reminder to display guidance on the kiosk."
            action={<Button onClick={() => openEditor()}>Add reminder</Button>}
          />
        )}
      </section>
      {editor && (
        <div className="modal-backdrop" onMouseDown={() => setEditor(null)}>
          <section
            className="course-modal reminder-editor-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">KIOSK CONTENT</p>
                <h2>{editor.id ? "Edit reminder" : "Add reminder"}</h2>
                <p>Control where and how this reminder appears.</p>
              </div>
              <button
                className="modal-close"
                onClick={() => setEditor(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setConfirm(true);
              }}
            >
              <label className="field">
                <span>Placement</span>
                <select
                  value={form.placement}
                  onChange={(event) =>
                    setForm({ ...form, placement: event.target.value })
                  }
                >
                  <option value="BANNER">Quick reminder banner</option>
                  <option value="GUIDELINE">Guidelines list</option>
                  <option value="TIP">Tip box</option>
                </select>
              </label>
              <Field
                label="Title"
                value={form.title}
                onChange={(value) => setForm({ ...form, title: value })}
              />
              <label className="field">
                <span>Supporting text (optional)</span>
                <textarea
                  rows="3"
                  maxLength="500"
                  value={form.message}
                  onChange={(event) =>
                    setForm({ ...form, message: event.target.value })
                  }
                />
              </label>
              <Field
                label="Display order"
                type="number"
                value={form.sortOrder}
                onChange={(value) => setForm({ ...form, sortOrder: value })}
              />
              <label className="status-toggle">
                <span>
                  <b>Visible on kiosk</b>
                  <small>Hidden reminders remain saved for later use.</small>
                </span>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm({ ...form, isActive: event.target.checked })
                  }
                />
                <i />
              </label>
              {error && <p className="error">{error}</p>}
              <footer>
                <Button variant="secondary" onClick={() => setEditor(null)}>
                  Cancel
                </Button>
                <button className="btn primary" disabled={saving}>
                  {saving ? "Saving..." : "Save reminder"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {confirm && editor && (
        <ConfirmModal
          title={editor.id ? "Save reminder changes?" : "Add this reminder?"}
          message={
            editor.id
              ? `Update the ${form.placement.toLowerCase()} reminder “${form.title}”?`
              : `Add the ${form.placement.toLowerCase()} reminder “${form.title}” to the kiosk?`
          }
          confirmLabel={editor.id ? "Save changes" : "Add reminder"}
          onClose={() => setConfirm(false)}
          onConfirm={save}
        />
      )}
    </>
  );
}

async function sendRequestReview(
  id,
  action,
  reviewToken,
  token,
  keepalive = false,
) {
  const path = `/admin/password-reset-requests/${id}/review${action === "acquire" ? "" : `/${action}`}`;
  const options = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminApi.getAccessToken() || token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reviewToken }),
  };
  const response = keepalive
    ? await fetch(`${API}${path}`, {
        ...options,
        credentials: "same-origin",
        keepalive: true,
      })
    : await adminFetch(path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data?.message || "Unable to update the request review."),
      { status: response.status },
    );
  return data;
}

function PasswordResetRequestsPage({ token }) {
  const [requests, setRequests] = useState([]),
    [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState(""),
    [loadingRequests, setLoadingRequests] = useState(true),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [refreshError, setRefreshError] = useState(""),
    [toast, setToast] = useState(""),
    [saving, setSaving] = useState(false),
    [openingReview, setOpeningReview] = useState(null),
    [queueFilter, setQueueFilter] = useState("PENDING"),
    [page, setPage] = useState(1),
    [passwordResetForm, setPasswordResetForm] = useState({
      replacePassword: false,
      password: "",
    }),
    [accountRequestForm, setAccountRequestForm] = useState({
      emailAddress: "",
      password: "",
    });
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selected]);
  useEffect(() => {
    if (!selected || saving) return;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected?.id, saving]);
  const refreshRequests = useRef(null);
  const mounted = useRef(true);
  const openingReviewRef = useRef(false);
  const reviewAuthToken = useRef(token);
  reviewAuthToken.current = token;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const headers = { Authorization: `Bearer ${token}` };
  const load = () => refreshRequests.current?.();
  useEffect(() => {
    const term = search.trim().replace(/\s+/g, " ");
    if (term === appliedSearch) return;
    const timer = setTimeout(() => {
      setAppliedSearch(term);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);
  useEffect(() => {
    if (!selected?.reviewToken) return;
    const session = { id: selected.id, token: selected.reviewToken };
    let active = true;
    let renewing = false;
    let expiryTimer;
    const expire = () => {
      if (!active) return;
      setSelected(null);
      setError(
        "Your review session ended. Review the request again before continuing.",
      );
      load();
    };
    const resetExpiry = (leaseMs) => {
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(expire, leaseMs);
    };
    const renew = async () => {
      if (!active || renewing) return;
      renewing = true;
      const startedAt = performance.now();
      try {
        const result = await sendRequestReview(
          session.id,
          "renew",
          session.token,
          reviewAuthToken.current,
        );
        if (active)
          resetExpiry(
            Math.max(0, result.leaseMs - (performance.now() - startedAt)),
          );
      } catch (err) {
        if ([401, 403, 404, 409].includes(err.status)) expire();
        // Network failures are allowed only until the last confirmed lease ends.
      } finally {
        renewing = false;
      }
    };
    const release = (keepalive) =>
      sendRequestReview(
        session.id,
        "release",
        session.token,
        reviewAuthToken.current,
        keepalive,
      ).catch(() => {});
    const pageHide = () => {
      void release(true);
      setSelected(null);
    };
    const visibilityChange = () => {
      if (document.visibilityState === "visible") void renew();
    };
    resetExpiry(selected.leaseMs);
    const timer = setInterval(renew, 20000);
    window.addEventListener("focus", renew);
    window.addEventListener("pagehide", pageHide);
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      active = false;
      clearInterval(timer);
      clearTimeout(expiryTimer);
      window.removeEventListener("focus", renew);
      window.removeEventListener("pagehide", pageHide);
      document.removeEventListener("visibilitychange", visibilityChange);
      void release(!mounted.current).finally(() => {
        if (mounted.current) load();
      });
    };
  }, [selected?.id, selected?.reviewToken]);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    let queuedRefresh = false;
    let lastSnapshot = "";
    setLoadingRequests(true);
    const refresh = async (force = false) => {
      if (
        controller.signal.aborted ||
        (!force && document.visibilityState === "hidden")
      )
        return;
      if (loading) {
        if (force) queuedRefresh = true;
        return;
      }
      loading = true;
      try {
        const next = await request(
          `/admin/password-reset-requests${appliedSearch ? `?search=${encodeURIComponent(appliedSearch)}` : ""}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        const snapshot = JSON.stringify(next);
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          setRequests(next);
        }
        setRefreshError("");
      } catch (err) {
        if (!controller.signal.aborted) setRefreshError(err.message);
      } finally {
        loading = false;
        if (!controller.signal.aborted) setLoadingRequests(false);
        if (queuedRefresh && !controller.signal.aborted) {
          queuedRefresh = false;
          refresh(true);
        }
      }
    };
    const refreshWhenVisible = () => refresh();
    refreshRequests.current = () => refresh(true);
    refresh();
    const timer = setInterval(refreshWhenVisible, 3000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      refreshRequests.current = null;
      clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [token, appliedSearch]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const complete = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await request(
        `/admin/password-reset-requests/${selected.id}/complete`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewToken: selected.reviewToken,
            ...(selected.request_kind === "ACCOUNT_CREATION"
              ? accountRequestForm
              : canReplacePassword && passwordResetForm.replacePassword
                ? {
                    replacePassword: true,
                    password: passwordResetForm.password,
                  }
                : {}),
          }),
        },
      );
      setSelected(null);
      setToast(response.message);
      load();
      window.dispatchEvent(new Event("credential-requests-updated"));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const rejectVoucher = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await request(
        `/admin/password-reset-requests/${selected.id}/reject`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ reviewToken: selected.reviewToken }),
        },
      );
      setSelected(null);
      setToast(response.message);
      load();
      window.dispatchEvent(new Event("credential-requests-updated"));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  const pending = requests.filter((item) => item.status === "PENDING").length;
  const orderedRequests = [...requests].sort((a, b) => {
    const statusOrder =
      Number(b.status === "PENDING") - Number(a.status === "PENDING");
    return statusOrder || new Date(b.requested_at) - new Date(a.requested_at);
  });
  const filteredRequests =
    queueFilter === "ALL"
      ? orderedRequests
      : queueFilter === "RESOLVED"
        ? orderedRequests.filter((item) => item.status !== "PENDING")
        : orderedRequests.filter((item) => item.status === queueFilter);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const visibleRequests = filteredRequests.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  const changeFilter = (filter) => {
    setQueueFilter(filter);
    setPage(1);
  };
  const reviewRequest = async (item) => {
    if (openingReviewRef.current) return;
    setError("");
    setToast("");
    setAccountRequestForm({ emailAddress: "", password: "" });
    setPasswordResetForm({ replacePassword: false, password: "" });
    if (item.status !== "PENDING") {
      setSelected(item);
      return;
    }
    openingReviewRef.current = true;
    setOpeningReview(item.id);
    let reviewToken;
    try {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      reviewToken = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const startedAt = performance.now();
      const review = await sendRequestReview(
        item.id,
        "acquire",
        reviewToken,
        reviewAuthToken.current,
      );
      if (!mounted.current) {
        void sendRequestReview(
          item.id,
          "release",
          reviewToken,
          reviewAuthToken.current,
          true,
        ).catch(() => {});
        return;
      }
      setSelected({
        ...item,
        reviewToken,
        leaseMs: Math.max(0, review.leaseMs - (performance.now() - startedAt)),
      });
      load();
    } catch (err) {
      if (mounted.current) {
        setError(err.message);
        load();
      }
      // The acquisition may have succeeded even when its response was lost.
      if (reviewToken)
        void sendRequestReview(
          item.id,
          "release",
          reviewToken,
          reviewAuthToken.current,
          true,
        ).catch(() => {});
    } finally {
      openingReviewRef.current = false;
      if (mounted.current) setOpeningReview(null);
    }
  };
  useEffect(() => {
    setSelected((current) => {
      if (!current) return current;
      const latest = requests.find((item) => item.id === current.id);
      return latest && latest.status === current.status ? current : null;
    });
  }, [requests]);
  const copyRequestValue = async (value, label) => {
    if (!value) return;
    setError("");
    setToast("");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // The LAN deployment uses HTTP, where the Clipboard API is unavailable.
        const field = document.createElement("textarea");
        const previousFocus = document.activeElement;
        field.value = value;
        field.readOnly = true;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        try {
          field.select();
          if (!document.execCommand("copy")) throw new Error("Copy failed.");
        } finally {
          field.remove();
          previousFocus?.focus({ preventScroll: true });
        }
      }
      setToast(`${label} copied.`);
    } catch {
      setError(
        `Unable to copy automatically. Select and copy the ${label.toLowerCase()} above.`,
      );
    }
  };
  const canReplacePassword =
    selected?.request_kind === "PASSWORD_RESET" &&
    ["EMAIL", "KUMOSOFT", "SCHOOLOGY"].includes(selected.credential_type);
  const isResolvedRequest = Boolean(selected && selected.status !== "PENDING");
  const generateRequestPassword = async () => {
    const creatingAccount = selected?.request_kind === "ACCOUNT_CREATION";
    if (
      saving ||
      (!creatingAccount &&
        !(canReplacePassword && passwordResetForm.replacePassword))
    )
      return;
    let password;
    try {
      password = generateRandomPassword();
    } catch {
      setError(
        "Unable to generate a password. Try again or enter one manually.",
      );
      return;
    }
    if (creatingAccount) {
      setAccountRequestForm((current) => ({ ...current, password }));
    } else {
      setPasswordResetForm((current) => ({ ...current, password }));
    }
    await copyRequestValue(password, "Generated password");
  };
  const resetSource = {
    EMAIL: "Google Workspace",
    KUMOSOFT: "Kumosoft",
    SCHOOLOGY: "Schoology",
  }[selected?.credential_type];
  const accountRequestReady =
    selected?.request_kind !== "ACCOUNT_CREATION" ||
    (Boolean(accountRequestForm.password) &&
      (selected.credential_type !== "EMAIL" ||
        Boolean(accountRequestForm.emailAddress.trim())));
  const passwordResetReady =
    selected?.request_kind !== "PASSWORD_RESET" ||
    (canReplacePassword && passwordResetForm.replacePassword
      ? Boolean(passwordResetForm.password.trim())
      : Boolean(selected.default_password));
  return (
    <>
      {toast && !selected && (
        <Toast message={toast} onClose={() => setToast("")} />
      )}
      <PageHeader
        title="Credential requests"
        description="Process password resets, missing-account requests, and administrator-approved voucher replacements."
        actions={
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
        }
      />
      <section className="student-summary reset-request-summary">
        <article>
          <span>
            {appliedSearch ? "Matching pending requests" : "Pending requests"}
          </span>
          <strong>{pending}</strong>
        </article>
        <article>
          <span>
            {appliedSearch ? "Matching password resets" : "Password resets"}
          </span>
          <strong>
            {
              requests.filter(
                (item) =>
                  item.status === "PENDING" &&
                  item.request_kind === "PASSWORD_RESET",
              ).length
            }
          </strong>
        </article>
        <article>
          <span>
            {appliedSearch ? "Matching account requests" : "Account requests"}
          </span>
          <strong>
            {
              requests.filter(
                (item) =>
                  item.status === "PENDING" &&
                  item.request_kind === "ACCOUNT_CREATION",
              ).length
            }
          </strong>
        </article>
        <article>
          <span>
            {appliedSearch ? "Matching voucher requests" : "Voucher requests"}
          </span>
          <strong>
            {
              requests.filter(
                (item) =>
                  item.status === "PENDING" &&
                  item.request_kind === "VOUCHER_REQUEST",
              ).length
            }
          </strong>
        </article>
      </section>
      <section className="panel reset-request-panel">
        <div className="course-intro">
          Password resets use the stored default password. Account requests
          require creating the missing account. Voucher requests replace the
          current code only after administrator approval.
        </div>
        {(error || refreshError) && (
          <p className="error">{error || refreshError}</p>
        )}
        <div className="request-queue-toolbar">
          <div
            className="request-filter-tabs"
            aria-label="Filter credential requests"
          >
            <button
              type="button"
              className={queueFilter === "PENDING" ? "active" : ""}
              onClick={() => changeFilter("PENDING")}
            >
              Pending <span>{pending}</span>
            </button>
            <button
              type="button"
              className={queueFilter === "RESOLVED" ? "active" : ""}
              onClick={() => changeFilter("RESOLVED")}
            >
              Resolved <span>{requests.length - pending}</span>
            </button>
            <button
              type="button"
              className={queueFilter === "ALL" ? "active" : ""}
              onClick={() => changeFilter("ALL")}
            >
              All <span>{requests.length}</span>
            </button>
          </div>
          <div className="request-queue-tools">
            <label className="records-table-field records-table-search">
              <span>Search requests</span>
              <span className="records-table-search-input">
                <AppIcon name="search" size={18} />
                <input
                  type="search"
                  aria-label="Search credential requests"
                  placeholder="Search all columns"
                  maxLength={200}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>
            <small role={loadingRequests ? "status" : undefined}>
              {loadingRequests
                ? "Loading requests..."
                : "Pending first · Newest first"}
            </small>
          </div>
        </div>
        {filteredRequests.length ? (
          <div className="reset-request-table-wrap">
            <table className="reset-request-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Account</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRequests.map((item) => (
                  <tr
                    key={item.id}
                    className={
                      item.status === "PENDING" ? "request-row-pending" : ""
                    }
                  >
                    <td>
                      <span className="student-cell">
                        <b>
                          {[item.first_name, item.middle_name, item.last_name]
                            .filter(Boolean)
                            .join(" ")}
                        </b>
                        <small>
                          {item.school_id} · {item.course_code}
                        </small>
                      </span>
                    </td>
                    <td>
                      <b
                        className="request-account-badge"
                        data-account={item.credential_type}
                      >
                        {item.credential_type === "VOUCHER"
                          ? "WiFi Voucher"
                          : item.credential_type}
                      </b>
                      <small
                        className="reset-account-username"
                        data-request-kind={item.request_kind}
                      >
                        {item.request_kind === "ACCOUNT_CREATION"
                          ? "Account creation"
                          : item.request_kind === "VOUCHER_REQUEST"
                            ? "Replacement request"
                            : item.account_username || "Password reset"}
                      </small>
                    </td>
                    <td>
                      <span className="request-date">
                        <b>
                          {new Date(item.requested_at).toLocaleDateString()}
                        </b>
                        <small>
                          {new Date(item.requested_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </span>
                    </td>
                    <td>
                      <span className="request-status-cell">
                        <Status
                          tone={
                            item.status === "PENDING"
                              ? "gold"
                              : item.status === "REJECTED"
                                ? "danger"
                                : "green"
                          }
                        >
                          {item.status === "PENDING"
                            ? "Pending"
                            : item.status === "REJECTED"
                              ? "Rejected"
                              : "Completed"}
                        </Status>
                        {item.status !== "PENDING" && item.resolved_at && (
                          <small>
                            {new Date(item.resolved_at).toLocaleDateString()}{" "}
                            {new Date(item.resolved_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                        )}
                      </span>
                    </td>
                    <td>
                      {item.status === "PENDING" ? (
                        <div className="request-review-action">
                          <Button
                            variant="secondary"
                            disabled={
                              Boolean(item.reviewing_until) ||
                              openingReview !== null
                            }
                            onClick={() => reviewRequest(item)}
                          >
                            {openingReview === item.id
                              ? "Opening..."
                              : item.reviewing_until
                                ? "Being reviewed"
                                : "Review request"}
                          </Button>
                          {item.reviewing_until && (
                            <small>
                              Reviewing:{" "}
                              {item.reviewing_by_name ||
                                "Another administrator"}
                            </small>
                          )}
                        </div>
                      ) : (
                        <div className="resolved-request-action">
                          <Button
                            variant="secondary"
                            onClick={() => reviewRequest(item)}
                          >
                            View details
                          </Button>
                          {item.resolved_by_name && (
                            <small>{item.resolved_by_name}</small>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="request-pagination">
              <span>
                Showing {(page - 1) * pageSize + 1}–
                {Math.min(page * pageSize, filteredRequests.length)} of{" "}
                {filteredRequests.length}
              </span>
              <div>
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((current) => current - 1)}
                  aria-label="Previous page"
                >
                  <AppIcon name="chevron_left" size={20} />
                </button>
                <b>
                  Page {page} of {pageCount}
                </b>
                <button
                  type="button"
                  disabled={page === pageCount}
                  onClick={() => setPage((current) => current + 1)}
                  aria-label="Next page"
                >
                  <AppIcon name="chevron_right" size={20} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <Empty
            title={
              appliedSearch
                ? "No matching requests"
                : `No ${queueFilter === "ALL" ? "credential" : queueFilter.toLowerCase()} requests`
            }
            detail={
              appliedSearch
                ? "Try another search term or change the queue filter."
                : queueFilter === "PENDING"
                  ? "There are no requests waiting for administrator action."
                  : "No requests match this queue filter."
            }
          />
        )}
      </section>
      {selected &&
        createPortal(
          <div
            className="modal-backdrop credential-request-overlay"
            onMouseDown={(event) => {
              if (!saving && event.target === event.currentTarget)
                setSelected(null);
            }}
          >
            <section
              className="course-modal reset-request-modal"
              data-request-kind={selected.request_kind}
              role="dialog"
              aria-modal="true"
              aria-labelledby="credential-request-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <p className="eyebrow">
                    {isResolvedRequest
                      ? "RESOLVED REQUEST"
                      : selected.request_kind === "ACCOUNT_CREATION"
                        ? "ACCOUNT REQUEST"
                        : selected.request_kind === "VOUCHER_REQUEST"
                          ? "VOUCHER REQUEST"
                          : "PASSWORD RESET"}
                  </p>
                  <h2 id="credential-request-title">
                    {selected.request_kind === "VOUCHER_REQUEST"
                      ? "New WiFi voucher"
                      : `${selected.credential_type} account`}
                  </h2>
                  <p>
                    {[
                      selected.first_name,
                      selected.middle_name,
                      selected.last_name,
                    ]
                      .filter(Boolean)
                      .join(" ")}{" "}
                    · {selected.school_id}
                  </p>
                </div>
                <button
                  className="modal-close"
                  disabled={saving}
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                >
                  &times;
                </button>
              </header>
              <div className="reset-request-details">
                {isResolvedRequest ? (
                  <ResolvedRequestDetails
                    request={selected}
                    onCopy={copyRequestValue}
                  />
                ) : selected.request_kind === "ACCOUNT_CREATION" ? (
                  <>
                    <p>
                      Enter the account credentials to link them to this
                      student.
                    </p>
                    {selected.credential_type === "EMAIL" ? (
                      <label className="field">
                        <span>Institutional email address</span>
                        <input
                          type="email"
                          required
                          value={accountRequestForm.emailAddress}
                          onChange={(event) =>
                            setAccountRequestForm({
                              ...accountRequestForm,
                              emailAddress: event.target.value,
                            })
                          }
                          placeholder="student@ndmu.edu.ph"
                        />
                      </label>
                    ) : (
                      <RequestValueField
                        label="Username"
                        value={selected.school_id}
                        onCopy={() =>
                          copyRequestValue(selected.school_id, "Username")
                        }
                      />
                    )}
                    <RequestPasswordField
                      label="Account password"
                      value={accountRequestForm.password}
                      saving={saving}
                      onChange={(password) =>
                        setAccountRequestForm((current) => ({
                          ...current,
                          password,
                        }))
                      }
                      onGenerate={generateRequestPassword}
                    />
                  </>
                ) : selected.request_kind === "VOUCHER_REQUEST" ? (
                  <>
                    <label>
                      <span>Current voucher</span>
                      <code>{selected.account_username || "Unavailable"}</code>
                    </label>
                    <label>
                      <span>Student's reason</span>
                      <p className="voucher-request-admin-reason">
                        {selected.request_reason}
                      </p>
                    </label>
                    <p>
                      Approving releases the current voucher and assigns the
                      next available active voucher. This action cannot be
                      undone from this dialog.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="request-account-values">
                      <RequestValueField
                        label={
                          selected.credential_type === "EMAIL"
                            ? "Email address"
                            : "Username"
                        }
                        value={selected.account_username}
                        onCopy={() =>
                          copyRequestValue(
                            selected.account_username,
                            selected.credential_type === "EMAIL"
                              ? "Email address"
                              : "Username",
                          )
                        }
                      />
                      <RequestValueField
                        label="Default password"
                        value={selected.default_password}
                        onCopy={() =>
                          copyRequestValue(
                            selected.default_password,
                            "Default password",
                          )
                        }
                      />
                    </div>
                    {canReplacePassword && (
                      <div className="request-password-section">
                        <label className="status-toggle">
                          <span>
                            <b>Replace default password</b>
                            <small>
                              Save a new default password for this account.
                            </small>
                          </span>
                          <input
                            type="checkbox"
                            checked={passwordResetForm.replacePassword}
                            disabled={saving}
                            onChange={(event) =>
                              setPasswordResetForm({
                                replacePassword: event.target.checked,
                                password: "",
                              })
                            }
                          />
                          <i />
                        </label>
                        {passwordResetForm.replacePassword && (
                          <RequestPasswordField
                            label="Replacement password"
                            value={passwordResetForm.password}
                            saving={saving}
                            onChange={(password) =>
                              setPasswordResetForm((current) => ({
                                ...current,
                                password,
                              }))
                            }
                            onGenerate={generateRequestPassword}
                          />
                        )}
                      </div>
                    )}
                    <p className="request-completion-note">
                      {canReplacePassword && passwordResetForm.replacePassword
                        ? `Reset the password in ${resetSource} first. Completing this request saves the replacement as the student's new default password.`
                        : `Reset the account in ${resetSource || selected.credential_type} using this password, then mark the request completed.`}
                    </p>
                  </>
                )}
                {error && <p className="error">{error}</p>}
              </div>
              <footer className="reset-request-footer">
                {isResolvedRequest ? (
                  <Button variant="secondary" onClick={() => setSelected(null)}>
                    Close
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      disabled={saving}
                      onClick={() => setSelected(null)}
                    >
                      Cancel
                    </Button>
                    {selected.request_kind === "VOUCHER_REQUEST" && (
                      <button
                        className="btn danger"
                        disabled={saving}
                        onClick={rejectVoucher}
                      >
                        {saving ? "Saving..." : "Reject request"}
                      </button>
                    )}
                    <button
                      className="btn primary"
                      disabled={
                        saving || !accountRequestReady || !passwordResetReady
                      }
                      onClick={complete}
                    >
                      {saving
                        ? "Completing..."
                        : selected.request_kind === "ACCOUNT_CREATION"
                          ? "Create account and complete"
                          : selected.request_kind === "VOUCHER_REQUEST"
                            ? "Approve and assign voucher"
                            : "Mark reset completed"}
                    </button>
                  </>
                )}
              </footer>
            </section>
            {toast && <Toast message={toast} onClose={() => setToast("")} />}
          </div>,
          document.body,
        )}
    </>
  );
}

function AdminUsersPage({ token }) {
  const requestPermissionsLabel = (user) => {
    const count = effectiveRequestPermissions(
      user.requestPermissions,
      user.role_name,
    ).length;
    return count === REQUEST_PERMISSION_KEYS.length
      ? "All request types"
      : `${count} request permissions`;
  };
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    username: "",
    password: "",
    roleId: "",
    isActive: true,
    requestPermissions: [],
  });
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editor]);
  const headers = { Authorization: `Bearer ${token}` };
  const load = () =>
    Promise.all([
      request("/admin/admin-users", { headers }),
      request("/admin/admin-roles", { headers }),
    ])
      .then(([userRows, roleRows]) => {
        setUsers(userRows);
        setRoles(roleRows);
      })
      .catch((err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const openEditor = (user = null) => {
    setConfirm(false);
    const defaultRole =
      roles.find((role) => role.name === "Request Staff") ||
      roles.find((role) => role.name === "Super Admin") ||
      roles[0];
    const parts = user ? user.full_name.trim().split(/\s+/) : [];
    const firstName = parts.shift() || "";
    const lastName = parts.length ? parts.pop() : "";
    setForm(
      user
        ? {
            firstName,
            middleName: parts.join(" "),
            lastName,
            username: user.username,
            password: "",
            roleId: String(user.role_id),
            isActive: Boolean(user.is_active),
            requestPermissions: effectiveRequestPermissions(
              user.requestPermissions,
              user.role_name,
            ),
          }
        : {
            firstName: "",
            middleName: "",
            lastName: "",
            username: "",
            password: "",
            roleId: defaultRole ? String(defaultRole.id) : "",
            isActive: true,
            requestPermissions: effectiveRequestPermissions(
              null,
              defaultRole?.name,
            ),
          },
    );
    setError("");
    setEditor(user || {});
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await request(
        editor.id ? `/admin/admin-users/${editor.id}` : "/admin/admin-users",
        {
          method: editor.id ? "PATCH" : "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, roleId: Number(form.roleId) }),
        },
      );
      setEditor(null);
      setToast(result.message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Admin users"
        description="Create and maintain administrator accounts and access roles."
        actions={
          <Button onClick={() => openEditor()}>Add administrator</Button>
        }
      />
      <section className="student-summary admin-user-summary">
        <article>
          <span>Total administrators</span>
          <strong>{users.length}</strong>
        </article>
        <article>
          <span>Active accounts</span>
          <strong>{users.filter((user) => user.is_active).length}</strong>
        </article>
        <article>
          <span>Access roles</span>
          <strong>{roles.length}</strong>
        </article>
      </section>
      <section className="panel student-panel admin-users-data-table">
        <div className="course-intro">
          Only active administrators can sign in. Keep at least one Super Admin
          account active.
        </div>
        {error && !editor && <p className="error">{error}</p>}
        {users.length ? (
          <DataTable
            data={users}
            columns={[
              { data: null },
              { data: "username" },
              { data: "role_name" },
              { data: "is_active" },
              { data: "last_login" },
              { data: null, orderable: false, searchable: false },
            ]}
            slots={{
              0: (_data, type, row) =>
                type === "display" ? (
                  <span className="student-cell">
                    <b>{row.full_name}</b>
                    <small>
                      Added {new Date(row.created_at).toLocaleDateString()}
                    </small>
                  </span>
                ) : type === "filter" ? (
                  `${row.full_name} Added ${dateSearchText(row.created_at)}`
                ) : (
                  row.full_name || ""
                ),
              1: (data, type, _row) =>
                type === "display" ? (
                  <span className="admin-email">{data}</span>
                ) : (
                  String(data ?? "")
                ),
              2: (data, type, row) =>
                type === "display" ? (
                  <span className="admin-role-cell">
                    <Status tone={data === "Super Admin" ? "green" : "gold"}>
                      {data}
                    </Status>
                    <small>{requestPermissionsLabel(row)}</small>
                  </span>
                ) : type === "filter" ? (
                  `${data} ${requestPermissionsLabel(row)}`
                ) : (
                  String(data ?? "")
                ),
              3: (data, type, _row) =>
                type === "display" ? (
                  <Status tone={data ? "green" : "danger"}>
                    {data ? "Active" : "Inactive"}
                  </Status>
                ) : type === "filter" ? (
                  data ? (
                    "Active"
                  ) : (
                    "Inactive"
                  )
                ) : (
                  Number(data)
                ),
              4: (data, type, _row) =>
                type === "filter" ? (
                  data ? (
                    dateSearchText(data)
                  ) : (
                    "Never"
                  )
                ) : type !== "display" ? (
                  data || ""
                ) : data ? (
                  new Date(data).toLocaleString()
                ) : (
                  <span className="muted-cell">Never</span>
                ),
              5: (_data, row) => (
                <Button variant="secondary" onClick={() => openEditor(row)}>
                  Edit
                </Button>
              ),
            }}
            options={{
              pageLength: 10,
              lengthMenu: [10, 25, 50],
              order: [[0, "asc"]],
              language: {
                search: "Search administrators:",
                emptyTable: "No administrators found.",
              },
            }}
          >
            <thead>
              <tr>
                <th>Administrator</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Action</th>
              </tr>
            </thead>
          </DataTable>
        ) : (
          <Empty
            title="No administrators found"
            detail="Add an administrator account to begin."
            action={
              <Button onClick={() => openEditor()}>Add administrator</Button>
            }
          />
        )}
      </section>
      {editor &&
        createPortal(
          <div
            className="modal-backdrop admin-user-overlay"
            onMouseDown={() => setEditor(null)}
          >
            <section
              className="course-modal admin-user-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-user-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <p className="eyebrow">ACCESS CONTROL</p>
                  <h2 id="admin-user-title">
                    {editor.id ? "Edit administrator" : "Add administrator"}
                  </h2>
                  <p>
                    {editor.id
                      ? "Update account details, access, or password."
                      : "Create a secure administrator account."}
                  </p>
                </div>
                <button
                  className="modal-close"
                  onClick={() => setEditor(null)}
                  aria-label="Close"
                >
                  &times;
                </button>
              </header>
              <form
                className="admin-user-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  setConfirm(true);
                }}
              >
                <div className="admin-user-form-body">
                  <div className="admin-name-fields">
                    <Field
                      label="Last name"
                      value={form.lastName}
                      onChange={(value) =>
                        setForm({ ...form, lastName: value })
                      }
                    />
                    <Field
                      label="First name"
                      value={form.firstName}
                      onChange={(value) =>
                        setForm({ ...form, firstName: value })
                      }
                    />
                    <Field
                      label="Middle name (optional)"
                      value={form.middleName}
                      onChange={(value) =>
                        setForm({ ...form, middleName: value })
                      }
                    />
                  </div>
                  <div className="admin-access-fields">
                    <Field
                      label="Email address"
                      type="email"
                      value={form.username}
                      onChange={(value) =>
                        setForm({ ...form, username: value })
                      }
                    />
                    <label className="field">
                      <span>Access role</span>
                      <select
                        required
                        value={form.roleId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            roleId: event.target.value,
                            requestPermissions: effectiveRequestPermissions(
                              null,
                              roles.find(
                                (role) =>
                                  String(role.id) === event.target.value,
                              )?.name,
                            ),
                          })
                        }
                      >
                        <option value="">Select a role</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <fieldset
                    className="admin-request-permissions"
                    disabled={saving}
                  >
                    <legend>Credential request permissions</legend>
                    <p>
                      Choose the requests this administrator can view and
                      process.
                    </p>
                    <div className="admin-permission-actions">
                      <Button
                        variant="secondary"
                        disabled={saving}
                        onClick={() =>
                          setForm({
                            ...form,
                            requestPermissions: [...REQUEST_PERMISSION_KEYS],
                          })
                        }
                      >
                        Select all
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={saving}
                        onClick={() =>
                          setForm({ ...form, requestPermissions: [] })
                        }
                      >
                        Clear
                      </Button>
                      <small aria-live="polite">
                        {form.requestPermissions.length} of{" "}
                        {REQUEST_PERMISSION_KEYS.length} selected
                      </small>
                    </div>
                    <div className="admin-permission-table-wrap">
                      <table className="admin-permission-table">
                        <thead>
                          <tr>
                            <th scope="col">Account</th>
                            <th scope="col">Password resets</th>
                            <th scope="col">Account creation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {REQUEST_PERMISSION_GROUPS.map((group) => (
                            <tr key={group.type}>
                              <th scope="row">{group.label}</th>
                              {group.kinds.map((kind) => {
                                const key = group.type + ":" + kind;
                                const label = {
                                  PASSWORD_RESET: "Password resets",
                                  ACCOUNT_CREATION: "Account creation",
                                  VOUCHER_REQUEST: "Voucher requests",
                                }[kind];
                                return (
                                  <td
                                    key={key}
                                    colSpan={kind === "VOUCHER_REQUEST" ? 2 : 1}
                                  >
                                    <label>
                                      <input
                                        type="checkbox"
                                        aria-label={group.label + " " + label}
                                        checked={form.requestPermissions.includes(
                                          key,
                                        )}
                                        onChange={(event) =>
                                          setForm((current) => ({
                                            ...current,
                                            requestPermissions: event.target
                                              .checked
                                              ? [
                                                  ...current.requestPermissions,
                                                  key,
                                                ]
                                              : current.requestPermissions.filter(
                                                  (value) => value !== key,
                                                ),
                                          }))
                                        }
                                      />
                                      {kind === "VOUCHER_REQUEST" && (
                                        <span>Voucher requests</span>
                                      )}
                                    </label>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!form.requestPermissions.length && (
                      <small>No request access is selected.</small>
                    )}
                  </fieldset>
                  <label className="field">
                    <span>
                      {editor.id ? "New password (optional)" : "Password"}
                    </span>
                    <input
                      type="text"
                      required={!editor.id}
                      minLength={editor.id && !form.password ? undefined : 12}
                      autoComplete="new-password"
                      placeholder={
                        editor.id
                          ? "Leave blank to keep current password"
                          : "Minimum 12 characters"
                      }
                      value={form.password}
                      onChange={(event) =>
                        setForm({ ...form, password: event.target.value })
                      }
                    />
                  </label>
                  <label className="status-toggle">
                    <span>
                      <b>Active account</b>
                      <small>Inactive administrators cannot sign in.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(event) =>
                        setForm({ ...form, isActive: event.target.checked })
                      }
                    />
                    <i />
                  </label>
                  {error && <p className="error">{error}</p>}
                </div>
                <footer className="admin-user-form-footer">
                  <Button variant="secondary" onClick={() => setEditor(null)}>
                    Cancel
                  </Button>
                  <button className="btn primary" disabled={saving}>
                    {saving ? "Saving..." : "Save administrator"}
                  </button>
                </footer>
              </form>
            </section>
          </div>,
          document.body,
        )}
      {confirm &&
        editor &&
        createPortal(
          <div className="admin-user-confirm-overlay">
            <ConfirmModal
              title={
                editor.id ? "Save administrator changes?" : "Add administrator?"
              }
              message={
                editor.id
                  ? `Update access details for ${form.firstName} ${form.lastName}?`
                  : `Create an administrator account for ${form.firstName} ${form.lastName}?`
              }
              confirmLabel={editor.id ? "Save changes" : "Add administrator"}
              onClose={() => setConfirm(false)}
              onConfirm={save}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function ReleaseVouchersPage({ token }) {
  const [quantity, setQuantity] = useState("1"),
    [preview, setPreview] = useState([]),
    [released, setReleased] = useState([]),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const codes = released.map((voucher) => voucher.voucher_code).join("\n");
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const prepare = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setReleased([]);
    try {
      const result = await request(
        `/admin/voucher-records/release/preview?quantity=${encodeURIComponent(quantity)}`,
        { headers },
      );
      setPreview(result.vouchers || []);
      if (result.message && result.vouchers?.length !== Number(quantity))
        setToast(result.message);
      if (!result.vouchers?.length)
        setError("There are no available vouchers to release.");
    } catch (err) {
      setPreview([]);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const release = async () => {
    setConfirm(false);
    setBusy(true);
    setError("");
    try {
      const result = await request("/admin/voucher-records/release", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          voucherIds: preview.map((voucher) => voucher.id),
        }),
      });
      setReleased(result.vouchers || []);
      setPreview([]);
      setToast(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codes);
      setToast("Released voucher codes copied.");
    } catch {
      setError(
        "Unable to copy automatically. Select and copy the codes below.",
      );
    }
  };
  const downloadCodes = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([codes + "\n"], { type: "text/plain;charset=utf-8" }),
    );
    link.download = `released-wifi-vouchers-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  };
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Release vouchers"
        description="Set aside available WiFi vouchers for external release. Released codes cannot return to automatic student assignment."
      />
      {error && <p className="error release-page-error">{error}</p>}
      <section className="release-vouchers-grid">
        <article className="panel release-generator">
          <div className="release-panel-heading">
            <AppIcon name="confirmation_number" size={24} />
            <div>
              <p className="eyebrow">STEP 1</p>
              <h2>Prepare vouchers</h2>
            </div>
          </div>
          <p>Choose how many available voucher codes you need to release.</p>
          <form onSubmit={prepare}>
            <label className="field">
              <span>Number of vouchers</span>
              <input
                type="number"
                min="1"
                max="1000"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <button className="btn primary wide" disabled={busy}>
              {busy ? "Preparing..." : "Get vouchers"}
            </button>
          </form>
        </article>
        <article className="panel release-preview">
          <div className="release-panel-heading">
            <AppIcon name="fact_check" size={24} />
            <div>
              <p className="eyebrow">STEP 2</p>
              <h2>Review and release</h2>
            </div>
          </div>
          {preview.length ? (
            <>
              <p>
                {preview.length} voucher{preview.length === 1 ? " is" : "s are"}{" "}
                ready for permanent release.
              </p>
              <div className="release-code-list">
                {preview.map((voucher, index) => (
                  <code key={voucher.id}>
                    <small>{String(index + 1).padStart(2, "0")}</small>
                    {voucher.voucher_code}
                  </code>
                ))}
              </div>
              <footer>
                <Button variant="secondary" onClick={() => setPreview([])}>
                  Clear
                </Button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => setConfirm(true)}
                >
                  <AppIcon name="assignment_turned_in" /> Release{" "}
                  {preview.length} voucher{preview.length === 1 ? "" : "s"}
                </button>
              </footer>
            </>
          ) : (
            <div className="release-empty">
              <span className="release-empty-icon" aria-hidden="true">
                <AppIcon name="inventory_2" size={26} />
              </span>
              <div>
                <b>Ready to review vouchers</b>
                <span>
                  Choose a quantity, then select <em>Get vouchers</em> to
                  prepare the release list.
                </span>
              </div>
            </div>
          )}
        </article>
      </section>
      {released.length > 0 && (
        <section className="panel released-output">
          <div>
            <p className="eyebrow">RELEASE COMPLETE</p>
            <h2>
              {released.length} voucher{released.length === 1 ? "" : "s"}{" "}
              released
            </h2>
            <p>
              Keep this list secure. These codes are permanently excluded from
              student assignment.
            </p>
          </div>
          <div className="released-output-actions">
            <Button variant="secondary" onClick={copyCodes}>
              <AppIcon name="content_copy" /> Copy codes
            </Button>
            <Button onClick={downloadCodes}>
              <AppIcon name="download" /> Download .txt
            </Button>
          </div>
          <div
            className="released-code-list"
            aria-label="Released voucher codes"
          >
            {released.map((voucher, index) => (
              <code key={voucher.id}>
                <small>{String(index + 1).padStart(2, "0")}</small>
                {voucher.voucher_code}
              </code>
            ))}
          </div>
        </section>
      )}
      {confirm && (
        <ConfirmModal
          title="Release selected vouchers?"
          message={`${preview.length} voucher code${preview.length === 1 ? "" : "s"} will be permanently removed from available stock and cannot be assigned to students.`}
          confirmLabel="Release vouchers"
          onConfirm={release}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  );
}

function VouchersPage({ token }) {
  const [listing, setListing] = useState(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(25),
    [searchInput, setSearchInput] = useState(""),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("code"),
    [direction, setDirection] = useState("asc"),
    [showInactive, setShowInactive] = useState(false),
    [revision, setRevision] = useState(0),
    [importing, setImporting] = useState(false),
    [releaseTarget, setReleaseTarget] = useState(null),
    [clearSemesterOpen, setClearSemesterOpen] = useState(false),
    [statusTarget, setStatusTarget] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const load = () => setRevision((value) => value + 1);
  const summary = listing?.summary;
  const rows = listing?.data || [];
  const total = Number(listing?.recordsFiltered || 0);
  const pages = Math.max(1, Math.ceil(total / limit));
  useEffect(() => {
    if (searchInput.trim() === search) return;
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchInput, search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      draw: "1",
      start: String((page - 1) * limit),
      length: String(limit),
      "search[value]": search,
      sort,
      direction,
      status: showInactive ? "all" : "active",
    });
    request(`/admin/voucher-records?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(
          1,
          Math.ceil(Number(result.recordsFiltered) / limit),
        );
        if (page > lastPage) setPage(lastPage);
        setListing(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, page, limit, search, sort, direction, showInactive, revision]);
  const changeSort = (column) => {
    setDirection(sort === column && direction === "asc" ? "desc" : "asc");
    setSort(column);
    setPage(1);
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const release = async () => {
    const voucher = releaseTarget;
    setReleaseTarget(null);
    try {
      const result = await request(
        `/admin/voucher-records/${voucher.id}/release`,
        { method: "POST", headers },
      );
      setToast(result.message);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const clearSemester = async () => {
    setClearSemesterOpen(false);
    setError("");
    try {
      const result = await request("/admin/voucher-records/clear-semester", {
        method: "POST",
        headers,
      });
      setToast(result.message);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const updateStatus = async () => {
    const voucher = statusTarget;
    setStatusTarget(null);
    try {
      const result = await request(
        `/admin/voucher-records/${voucher.id}/status`,
        {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !voucher.is_active }),
        },
      );
      setToast(result.message);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="WiFi vouchers"
        description="Maintain voucher stock and see which student currently holds each voucher."
        actions={
          <>
            <Button
              variant="danger"
              disabled={!listing || !Number(summary?.total)}
              onClick={() => setClearSemesterOpen(true)}
            >
              Clear semester vouchers
            </Button>
            <Button onClick={() => setImporting(true)}>Import XLSX</Button>
          </>
        }
      />
      <section className="student-summary voucher-summary records-summary">
        <article>
          <span>Total vouchers</span>
          <strong>{summary?.total ?? "…"}</strong>
        </article>
        <article>
          <span>Available stock</span>
          <strong>{summary?.available ?? "…"}</strong>
        </article>
        <article>
          <span>Assigned vouchers</span>
          <strong>{summary?.assigned ?? "…"}</strong>
        </article>
      </section>
      <section className="panel student-panel vouchers-data-table records-data-table">
        <div className="course-intro">
          Available vouchers are assigned automatically when an administrator
          generates one for a student or when a student completes kiosk
          verification.
        </div>
        {error && <p className="error">{error}</p>}
        <div className="records-table-toolbar">
          <div className="records-table-filters">
            <InactiveRecordsToggle
              visible={showInactive}
              onChange={(visible) => {
                setShowInactive(visible);
                setPage(1);
              }}
            />
            <span className="sr-only" role="status">
              {loading ? "Loading vouchers..." : "Voucher records updated."}
            </span>
          </div>
          <RecordsTableControls
            search={searchInput}
            searchLabel="Search vouchers or students"
            searchPlaceholder="Search all columns"
            onSearchChange={setSearchInput}
            pageSize={limit}
            pageSizeLabel="Vouchers per page"
            onPageSizeChange={(size) => {
              setLimit(size);
              setPage(1);
            }}
          />
        </div>
        <div className="student-list-wrap" aria-busy={loading}>
          <table className="student-list-table">
            <thead>
              <tr>
                {[
                  ["code", "Voucher code"],
                  ["student", "Assigned student"],
                  ["status", "Status"],
                  ["assigned", "Assigned at"],
                ].map(([key, label]) => (
                  <th
                    key={key}
                    aria-sort={
                      sort === key
                        ? direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button onClick={() => changeSort(key)}>
                      {label}
                      {sort === key ? (direction === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <code className="voucher-code">{row.voucher_code}</code>
                  </td>
                  <td>
                    {row.student_id ? (
                      <span className="student-cell">
                        <b>
                          {[row.first_name, row.middle_name, row.last_name]
                            .filter(Boolean)
                            .join(" ")}
                        </b>
                        <small>{row.student_id}</small>
                      </span>
                    ) : (
                      <span className="muted-cell">Not assigned</span>
                    )}
                  </td>
                  <td>
                    <Status
                      tone={
                        !row.is_active
                          ? "danger"
                          : row.is_assigned
                            ? "gold"
                            : row.is_released
                              ? "gold"
                              : "green"
                      }
                    >
                      {!row.is_active
                        ? "Inactive"
                        : row.is_assigned
                          ? "Assigned"
                          : row.is_released
                            ? "Released"
                            : "Available"}
                    </Status>
                  </td>
                  <td>
                    {row.assigned_at ? (
                      new Date(row.assigned_at).toLocaleString()
                    ) : (
                      <span className="muted-cell">—</span>
                    )}
                  </td>
                  <td>
                    <span className="row-actions">
                      {Boolean(row.is_assigned) && (
                        <Button
                          variant="secondary"
                          onClick={() => setReleaseTarget(row)}
                        >
                          Release
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => setStatusTarget(row)}
                      >
                        {row.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan="5">
                    {error
                      ? "Could not load vouchers. Please retry."
                      : loading
                        ? "Loading vouchers…"
                        : search
                          ? "No vouchers match your search."
                          : "No vouchers in stock."}
                    {error && (
                      <Button variant="secondary" onClick={load}>
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="student-list-pagination">
          <span>
            Showing {rows.length ? (page - 1) * limit + 1 : 0}–
            {Math.min(page * limit, total)} of {total} vouchers
          </span>
          <div>
            <button
              aria-label="First page"
              onClick={() => setPage(1)}
              disabled={loading || page === 1}
            >
              «
            </button>
            <button
              aria-label="Previous page"
              onClick={() => setPage(page - 1)}
              disabled={loading || page === 1}
            >
              ‹
            </button>
            <label>
              Page{" "}
              <input
                aria-label="Page number"
                type="number"
                min="1"
                max={pages}
                value={page}
                onChange={(event) =>
                  setPage(
                    Math.min(
                      pages,
                      Math.max(1, Number(event.target.value) || 1),
                    ),
                  )
                }
              />{" "}
              of {pages}
            </label>
            <button
              aria-label="Next page"
              onClick={() => setPage(page + 1)}
              disabled={loading || page >= pages}
            >
              ›
            </button>
            <button
              aria-label="Last page"
              onClick={() => setPage(pages)}
              disabled={loading || page >= pages}
            >
              »
            </button>
          </div>
        </footer>
      </section>
      {importing && (
        <ImportHubModal
          type={voucherImportType}
          token={token}
          onClose={() => setImporting(false)}
          onComplete={(message) => {
            setToast(message);
            load();
          }}
        />
      )}
      {releaseTarget && (
        <ConfirmModal
          title="Release voucher"
          message={`Release ${releaseTarget.voucher_code}? Its student will automatically receive a different available voucher. The old code will be marked inactive and permanently excluded from stock. If no replacement is available, the current assignment will be kept.`}
          confirmLabel="Release voucher"
          onConfirm={release}
          onClose={() => setReleaseTarget(null)}
        />
      )}
      {clearSemesterOpen && (
        <ConfirmModal
          title="Clear semester vouchers"
          message={`Permanently delete all ${summary?.total || 0} voucher${(summary?.total || 0) === 1 ? "" : "s"}, including inactive and released records? Assigned students will lose their voucher links. This cannot be undone; import the new semester's voucher list afterward.`}
          confirmLabel="Delete semester vouchers"
          onConfirm={clearSemester}
          onClose={() => setClearSemesterOpen(false)}
        />
      )}
      {statusTarget && (
        <ConfirmModal
          title={`${statusTarget.is_active ? "Deactivate" : "Activate"} voucher`}
          message={
            statusTarget.is_active
              ? `Deactivate ${statusTarget.voucher_code}? Any current assignment will be released and cleared from the student's voucher record.`
              : `Activate ${statusTarget.voucher_code}? It will be available for future assignment.`
          }
          confirmLabel={
            statusTarget.is_active ? "Deactivate voucher" : "Activate voucher"
          }
          onConfirm={updateStatus}
          onClose={() => setStatusTarget(null)}
        />
      )}
    </>
  );
}
function App() {
  const { path, revision } = usePath();
  if (path.startsWith("/setup"))
    return (
      <div className="page-transition" key={`${path}-${revision}`}>
        <SetupPage />
      </div>
    );
  if (path.startsWith("/admin")) return <AdminApp />;
  return (
    <div className="page-transition" key={`${path}-${revision}`}>
      <Kiosk />
    </div>
  );
}
function StudentsPage({ token }) {
  const accountLabels = {
    EMAIL: "Email",
    KUMOSOFT: "Kumosoft",
    SCHOOLOGY: "Schoology",
    SATP: "SATP",
  };
  const [students, setStudents] = useState([]),
    [studentTotal, setStudentTotal] = useState(0),
    [activeStudentTotal, setActiveStudentTotal] = useState(0),
    [selected, setSelected] = useState(null),
    [editing, setEditing] = useState(null),
    [returnToView, setReturnToView] = useState(false),
    [adding, setAdding] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [limit, setLimit] = useState(25),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("active"),
    [missingAccount, setMissingAccount] = useState(""),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState(""),
    [sort, setSort] = useState("name"),
    [direction, setDirection] = useState("asc"),
    [refresh, setRefresh] = useState(0);
  const load = (signal) => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      status,
      search,
      missingAccount,
      sort,
      direction,
    });
    request(`/admin/students?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
      .then((data) => {
        if (signal.aborted) return;
        setStudents(data.rows);
        setStudentTotal(data.total);
        setActiveStudentTotal(data.activeTotal);
        setPages(data.pages);
        setError("");
      })
      .catch((e) => {
        if (!signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
  };
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [
    page,
    limit,
    search,
    status,
    missingAccount,
    sort,
    direction,
    refresh,
    token,
  ]);
  const exportWorkbook = async () => {
    setExporting(true);
    setExportError("");
    try {
      const params = new URLSearchParams({
        search,
        status,
        missingAccount,
        sort,
        direction,
      });
      const response = await adminFetch(`/admin/students/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        let message = "Unable to export student accounts. Please try again.";
        try {
          message = (await response.json()).message || message;
        } catch {}
        throw new Error(message);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || "students-linked-accounts.xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  };
  const changeSort = (column) => {
    if (sort === column)
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSort(column);
      setDirection("asc");
    }
    setPage(1);
  };
  const changePage = (next) => setPage(Math.max(1, Math.min(pages, next)));
  const open = (id, edit = false) =>
    request(`/admin/students/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((record) => {
        if (edit) {
          setReturnToView(false);
          setEditing(record);
        } else setSelected(record);
      })
      .catch((e) => setError(e.message));
  return (
    <>
      {loading && !students.length && (
        <LoadingModal
          title="Loading students"
          message="Preparing the student records table."
        />
      )}
      <PageHeader
        title="Students"
        description="Select a student to view or update their profile and linked credentials."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={exportWorkbook}
              disabled={exporting || loading}
            >
              <AppIcon name="download" />{" "}
              <span title="Export all students matching the current filters, across all pages.">
                {exporting ? "Exporting..." : "Export Excel"}
              </span>
            </Button>
            <Button onClick={() => setAdding(true)}>Add student</Button>
          </>
        }
      />
      <section className="student-summary records-summary">
        <article>
          <span>Total students</span>
          <strong>{studentTotal}</strong>
        </article>
        <article>
          <span>Active students</span>
          <strong>{activeStudentTotal}</strong>
        </article>
        <article>
          <span>Account types</span>
          <strong>4</strong>
        </article>
      </section>
      <section className="panel student-panel students-data-table records-data-table">
        {error && <p className="error">{error}</p>}
        {exportError && (
          <p className="error" role="alert">
            {exportError}
          </p>
        )}
        <div className="records-table-toolbar">
          <div className="records-table-filters">
            <label className="records-table-field">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                aria-label="Student status"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="records-table-field">
              <span>Missing account</span>
              <select
                aria-label="Filter students by missing account"
                value={missingAccount}
                onChange={(event) => {
                  setMissingAccount(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All students</option>
                {Object.entries(accountLabels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
                <option value="NONE">No linked accounts</option>
              </select>
            </label>
            <InactiveRecordsToggle
              visible={status !== "active"}
              onChange={(visible) => {
                setStatus(visible ? "all" : "active");
                setPage(1);
              }}
            />
            <span className="sr-only" role="status">
              {loading ? "Updating students..." : "Student records updated."}
            </span>
          </div>
          <RecordsTableControls
            search={search}
            searchLabel="Search students"
            searchPlaceholder="Search all columns"
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            pageSize={limit}
            pageSizeLabel="Students per page"
            onPageSizeChange={(size) => {
              setLimit(size);
              setPage(1);
            }}
          />
        </div>
        <div className="student-list-wrap" aria-busy={loading}>
          <table className="student-list-table">
            <thead>
              <tr>
                <th>
                  <button onClick={() => changeSort("name")}>Student</button>
                </th>
                <th>
                  <button onClick={() => changeSort("course")}>Course</button>
                </th>
                <th>Linked accounts</th>
                <th>
                  <button onClick={() => changeSort("status")}>Status</button>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td>
                    <span className="student-cell">
                      <b>
                        {[
                          student.first_name,
                          student.middle_name,
                          student.last_name,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      </b>
                      <small>
                        School ID: {student.student_id}
                        {student.kumosoft_id &&
                        student.kumosoft_id !== student.student_id
                          ? ` · Kumosoft ID: ${student.kumosoft_id}`
                          : ""}
                      </small>
                    </span>
                  </td>
                  <td>
                    <b>{student.course_code}</b>
                    <small>{student.course_name}</small>
                  </td>
                  <td>
                    {student.linkedAccounts?.length ? (
                      <div className="student-linked-accounts">
                        {student.linkedAccounts.map((account) => (
                          <span
                            key={account.type}
                            className="request-account-badge student-linked-account"
                            data-account={account.type}
                            data-inactive={!account.isActive}
                            title={`${accountLabels[account.type] || account.type} account linked${account.isActive ? "" : " but inactive"}`}
                          >
                            {accountLabels[account.type] || account.type}
                            {!account.isActive && " (inactive)"}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted-cell">No linked accounts</span>
                    )}
                  </td>
                  <td>
                    <Status tone={student.is_active ? "green" : "danger"}>
                      {student.is_active ? "Active" : "Inactive"}
                    </Status>
                  </td>
                  <td>
                    <span className="row-actions">
                      <Button
                        variant="secondary"
                        onClick={() => open(student.id)}
                      >
                        View
                      </Button>
                      <Button onClick={() => open(student.id, true)}>
                        Edit
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
              {!students.length && (
                <tr>
                  <td colSpan="5">
                    {loading
                      ? "Loading students..."
                      : "No students match your filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="student-list-pagination">
          <span>
            Showing {students.length ? (page - 1) * limit + 1 : 0}–
            {Math.min(page * limit, studentTotal)} of {studentTotal} students
          </span>
          <div>
            <button
              aria-label="First page"
              onClick={() => changePage(1)}
              disabled={page === 1}
            >
              «
            </button>
            <button
              aria-label="Previous page"
              onClick={() => changePage(page - 1)}
              disabled={page === 1}
            >
              ‹
            </button>
            <label>
              Page{" "}
              <input
                type="number"
                aria-label="Page number"
                min="1"
                max={pages}
                value={page}
                onChange={(event) =>
                  changePage(Number(event.target.value) || 1)
                }
              />{" "}
              of {pages}
            </label>
            <button
              aria-label="Next page"
              onClick={() => changePage(page + 1)}
              disabled={page === pages}
            >
              ›
            </button>
            <button
              aria-label="Last page"
              onClick={() => changePage(pages)}
              disabled={page === pages}
            >
              »
            </button>
          </div>
        </footer>
      </section>
      {adding && (
        <StudentFormModal
          token={token}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setRefresh((current) => current + 1);
          }}
        />
      )}
      <StudentProfileModal
        record={selected}
        onClose={() => setSelected(null)}
        onEdit={() => {
          setReturnToView(true);
          setEditing(selected);
          setSelected(null);
        }}
      />
      {editing && (
        <StudentEditModal
          record={editing}
          token={token}
          onClose={() => {
            setEditing(null);
            setReturnToView(false);
          }}
          onSaved={() => {
            const studentId = editing.student.id;
            const reopenProfile = returnToView;
            setEditing(null);
            setReturnToView(false);
            setRefresh((current) => current + 1);
            if (reopenProfile) open(studentId);
          }}
        />
      )}
    </>
  );
}
function StudentEditModal({ record, token, onClose, onSaved }) {
  const student = record.student,
    accounts = Object.fromEntries(
      record.accounts.map((account) => [account.type, account]),
    );
  const [courses, setCourses] = useState([]),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState({
    studentId: student.student_id,
    kumosoftId: student.kumosoft_id || "",
    firstName: student.first_name,
    middleName: student.middle_name || "",
    lastName: student.last_name,
    birthDate: String(student.birth_date).slice(0, 10),
    courseId: "",
    isActive: Boolean(student.is_active),
    satpPassword: accounts.SATP?.password || "",
    schoologyPassword: accounts.SCHOOLOGY?.password || "",
    kumosoftPassword: accounts.KUMOSOFT?.password || "",
    emailAddress: accounts.EMAIL?.username || "",
    emailPassword: accounts.EMAIL?.password || "",
    voucherCode: record.voucher?.code || "",
    assignNextVoucher: false,
    unassignVoucher: false,
  });
  useEffect(() => {
    request("/admin/courses", { headers: { Authorization: `Bearer ${token}` } })
      .then((data) => {
        setCourses(data);
        const course = data.find((item) => item.code === student.course_code);
        setForm((current) => ({
          ...current,
          courseId: String(course?.id || ""),
        }));
      })
      .catch((e) => setError(e.message));
  }, []);
  const update = (key, value) =>
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "emailAddress" && !value.trim() ? { emailPassword: "" } : {}),
    }));
  const generateVoucher = async () => {
    try {
      const data = await request(
        `/admin/students/${student.id}/voucher/generate`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      setForm({
        ...form,
        voucherCode: data.voucherCode,
        assignNextVoucher: false,
        unassignVoucher: false,
      });
    } catch (err) {
      setError(err.message);
    }
  };
  const save = async () => {
    setConfirm(false);
    try {
      await request(`/admin/students/${student.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <>
      <div className="modal-backdrop" onMouseDown={onClose}>
        <section
          className="student-modal edit-student-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header>
            <div>
              <p className="eyebrow">STUDENT MANAGEMENT</p>
              <h2>Edit student</h2>
              <p>Update student information and account credentials.</p>
            </div>
            <button className="modal-close" onClick={onClose}>
              &times;
            </button>
          </header>
          <form
            className="student-form"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirm(true);
            }}
          >
            <div className="form-section">
              <h3>Student information</h3>
              <div className="form-grid">
                <Field
                  label="School ID"
                  value={form.studentId}
                  onChange={(v) => update("studentId", v)}
                />
                <Field
                  label="Kumosoft ID (optional)"
                  value={form.kumosoftId}
                  onChange={(v) => update("kumosoftId", v)}
                />
                <Field
                  label="Last name"
                  value={form.lastName}
                  onChange={(v) => update("lastName", v)}
                />
                <Field
                  label="First name"
                  value={form.firstName}
                  onChange={(v) => update("firstName", v)}
                />
                <Field
                  label="Middle name (optional)"
                  value={form.middleName}
                  onChange={(v) => update("middleName", v)}
                />
                <Field
                  label="Birthday"
                  type="date"
                  value={form.birthDate}
                  onChange={(v) => update("birthDate", v)}
                />
                <CourseSearchSelect
                  courses={courses}
                  value={form.courseId}
                  onChange={(value) => update("courseId", value)}
                />
              </div>
            </div>
            <div className="form-section">
              <h3>Account credentials</h3>
              <p className="form-note">
                SATP and Schoology use the School ID. Kumosoft uses the Kumosoft
                ID when provided.
              </p>
              <p className="form-note">
                Clearing a password removes its saved value. Clearing the
                institutional email removes the linked email account.
              </p>
              <div className="form-grid">
                <Field
                  label="SATP password"
                  type="text"
                  value={form.satpPassword}
                  onChange={(v) => update("satpPassword", v)}
                />
                <Field
                  label="Schoology password"
                  type="text"
                  value={form.schoologyPassword}
                  onChange={(v) => update("schoologyPassword", v)}
                />
                <Field
                  label="Kumosoft password"
                  type="text"
                  value={form.kumosoftPassword}
                  onChange={(v) => update("kumosoftPassword", v)}
                />
                <Field
                  label="Institutional email"
                  type="email"
                  value={form.emailAddress}
                  onChange={(v) => update("emailAddress", v)}
                />
                <Field
                  label="Email password"
                  type="text"
                  value={form.emailPassword}
                  onChange={(v) => update("emailPassword", v)}
                />
              </div>
            </div>
            <div className="form-section voucher-edit-section">
              <div className="voucher-heading">
                <h3>Voucher code</h3>
                <Button variant="secondary" onClick={generateVoucher}>
                  Generate
                </Button>
              </div>
              <input
                readOnly
                value={form.voucherCode || "No voucher assigned"}
              />
              <p className="form-note">
                Clicking Generate assigns the next available voucher.
              </p>
              <label className="unassign-voucher">
                <input
                  type="checkbox"
                  checked={form.unassignVoucher}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      unassignVoucher: e.target.checked,
                      assignNextVoucher: false,
                    })
                  }
                />{" "}
                Unassign current voucher (if any)
              </label>
            </div>
            <label className="status-toggle">
              <span>
                <b>Active student</b>
                <small>Student can verify at the kiosk.</small>
              </span>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => update("isActive", e.target.checked)}
              />
              <i />
            </label>
            {error && <p className="error">{error}</p>}
            <footer className="modal-form-footer">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <button className="btn primary">Save changes</button>
            </footer>
          </form>
        </section>
      </div>
      {confirm && (
        <ConfirmModal
          title="Save student changes?"
          message={`Update ${form.firstName} ${form.lastName} and the linked account credentials?`}
          confirmLabel="Save changes"
          onClose={() => setConfirm(false)}
          onConfirm={save}
        />
      )}
    </>
  );
}
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <main className="admin-login">
          <section className="admin-panel">
            <span className="mark">NDMU MIS</span>
            <h1>Unable to load this page</h1>
            <p>
              The page encountered an error. Refresh to try again, or return to
              the portal login.
            </p>
            <pre className="error">{this.state.error.message}</pre>
            <button
              className="btn primary wide"
              onClick={() => {
                adminApi
                  .logout()
                  .catch(() => {})
                  .finally(() => location.assign(`${APP_BASE}/admin`));
              }}
            >
              Return to admin login
            </button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
