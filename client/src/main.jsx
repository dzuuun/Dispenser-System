import React, { Component, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import DataTable from "datatables.net-react";
import DT from "datatables.net-dt";
import "datatables.net-dt/css/dataTables.dataTables.css";
import "material-symbols/rounded.css";
import "./styles.css";
import ndmuLogo from "./assets/ndmu-logo.png";

const API = "/api";
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
  const res = await fetch(`${API}${path}`, { credentials: "same-origin", ...options });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data.message || "Unable to continue.");
  return data;
}
async function adminFetch(path, options = {}) {
  let response = await fetch(`${API}${path}`, { credentials: "same-origin", ...options });
  if (response.status !== 401 || !options.headers?.Authorization) return response;
  const refreshed = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
  });
  if (!refreshed.ok) return response;
  const session = await refreshed.json();
  dispatchEvent(new CustomEvent("admin-token-refreshed", { detail: session.accessToken }));
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  response = await fetch(`${API}${path}`, { credentials: "same-origin", ...options, headers });
  return response;
}
const go = (path) => {
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
};
function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  return path;
}
function Button({ children, onClick, variant = "primary" }) {
  return (
    <button type="button" className={`btn ${variant}`} onClick={onClick}>
      {children}
    </button>
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

function PasswordResetInfoModal({ accountTitle, submitting, onSubmit, onClose }) {
  return (
    <div className="modal-backdrop system-modal-backdrop" onMouseDown={submitting ? undefined : onClose}>
      <section className="system-modal password-reset-info-modal" onMouseDown={(event) => event.stopPropagation()}>
        <p className="eyebrow">PASSWORD RESET REQUEST</p>
        <h2>Reset your {accountTitle} password?</h2>
        <p>This sends a request to the ICT/MIS administrator. Your password will not change immediately.</p>
        <div className="password-reset-info-list">
          <article><AppIcon name="schedule" size={22} /><span><b>When to expect it</b><small>Requests are processed during regular ICT/MIS office hours. Completion time depends on the administrator's request queue.</small></span></article>
          <article><AppIcon name="notifications" size={22} /><span><b>How you will know</b><small>Return to this kiosk after one business day. The pending label will disappear once the reset is completed.</small></span></article>
          <article><AppIcon name="password" size={22} /><span><b>Use the default password</b><small>After one business day, use the account's default password. You can also open Credentials Summary and tap Show All to view it.</small></span></article>
        </div>
        <footer>
          <button type="button" className="btn secondary" disabled={submitting} onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={submitting} onClick={onSubmit}>{submitting ? "Submitting..." : "Submit request"}</button>
        </footer>
      </section>
    </div>
  );
}
function VoucherRequestModal({ reason, submitting, onReasonChange, onSubmit, onClose }) {
  const valid = reason.trim().length >= 10;
  return (
    <div className="modal-backdrop system-modal-backdrop" onMouseDown={submitting ? undefined : onClose}>
      <section className="system-modal voucher-request-info-modal" onMouseDown={(event) => event.stopPropagation()}>
        <p className="eyebrow">NEW VOUCHER REQUEST</p>
        <h2>Why do you need a new voucher?</h2>
        <p>Your current voucher remains active while this request waits for administrator approval.</p>
        <label className="field voucher-request-reason">
          <span>Reason for replacement</span>
          <textarea autoFocus rows="4" minLength="10" maxLength="500" value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Explain what happened to your current voucher..." />
          <small>{reason.trim().length} / 500 characters · Minimum 10</small>
        </label>
        <div className="voucher-request-note"><AppIcon name="approval" size={22} /><span><b>Administrator approval required</b><small>If approved, the old voucher will be released and a new available voucher will be assigned.</small></span></div>
        <footer>
          <button type="button" className="btn secondary" disabled={submitting} onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={submitting || !valid} onClick={onSubmit}>{submitting ? "Submitting..." : "Submit request"}</button>
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
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
      </section>
    </div>
  );
}
function AppIcon({ name, size = 18 }) {
  const materialName = { eye: "visibility", eyeOff: "visibility_off", settings: "settings" }[name] || name;
  return <span className="material-symbols-rounded app-icon" style={{ fontSize: `${size}px` }} aria-hidden="true">{materialName}</span>;
}
function Toast({ message, onClose, tone = "success" }) {
  const isError = tone === "error";
  return (
    <div className={`toast-notification${isError ? " error-toast" : ""}`} role={isError ? "alert" : "status"}>
      <span><AppIcon name={isError ? "error" : "check"} size={17} /></span>
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
      <div className="empty-icon">+</div>
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
            <span className="setup-icon">A</span>
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
function Field({ label, value, onChange, type = "text", placeholder }) {
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
  return (
    <label className={`field${emailField}${kumosoftField}`}>
      <span>{label}</span>
      <input
        type={visibleAccountPassword ? "text" : type}
        required={label.includes("optional") ? false : undefined}
        placeholder={placeholder || label.replace(/\s*\(.+\)/, "")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {schoolId && (
        <small className="field-hint">
          Automatically used as the SATP, Schoology, and Kumosoft username.
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
  ["ReleaseVouchers", "/admin/release-vouchers", "Release vouchers", "assignment_turned_in"],
  ["Imports", "/admin/imports", "Imports", "upload_file"],
  ["ResetRequests", "/admin/password-resets", "Credential requests", "contact_support"],
  ["Monitoring", "/admin/transactions", "Transactions", "receipt_long"],
  ["Kiosks", "/admin/kiosks", "Kiosks", "desktop_windows"],
  ["Reminders", "/admin/reminders", "Kiosk reminders", "notifications"],
  ["Controls", "/admin/module-controls", "Credential controls", "tune"],
  ["Administration", "/admin/users", "Admin users", "admin_panel_settings"],
];
function AdminShell({ children, path, onLogout, token }) {
  const [collapsed, setCollapsed] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  useEffect(() => {
    const loadPendingCount = () => request("/admin/password-reset-requests/pending-count", {
      headers: { Authorization: `Bearer ${token}` },
    }).then((result) => setPendingRequestCount(result.count)).catch(() => {});
    loadPendingCount();
    const timer = setInterval(loadPendingCount, 30000);
    window.addEventListener("credential-requests-updated", loadPendingCount);
    return () => {
      clearInterval(timer);
      window.removeEventListener("credential-requests-updated", loadPendingCount);
    };
  }, [token]);
  return (
    <div className={`portal ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          type="button"
          className="brand"
          title="Dashboard"
          onClick={() => go("/admin")}
        >
          <Brand compact light />
        </button>
        <p className="nav-section">OPERATIONS</p>
        <nav>
          {navGroups.map(([group, to, label, icon], index) => (
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
                onClick={() => go(to)}
              >
                <span className="nav-icon"><AppIcon name={icon} size={20} /></span>
                <span className="nav-label">{label}</span>
                {to === "/admin/password-resets" && pendingRequestCount > 0 && <span className="nav-notification-badge" aria-label={`${pendingRequestCount} pending requests`}>{pendingRequestCount > 99 ? "99+" : pendingRequestCount}</span>}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="admin-chip">
            <b>MIS Administrator</b>
            <small>Super Admin</small>
          </div>
          <button
            type="button"
            className="nav-link"
            title="Student kiosk"
            onClick={() => go("/")}
          >
            <span className="nav-icon"><AppIcon name="desktop_windows" size={20} /></span>
            <span className="nav-label">Student kiosk</span>
          </button>
          <button
            type="button"
            className="nav-link"
            title="Sign out"
            onClick={onLogout}
          >
            <span className="nav-icon"><AppIcon name="logout" size={20} /></span>
            <span className="nav-label">Sign out</span>
          </button>
        </div>
      </aside>
      <section className="portal-content">
        <header className="topbar">
          <button
            type="button"
            className="collapse-button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
          >
            <AppIcon name={collapsed ? "menu" : "close"} size={23} />
          </button>
          <Brand compact light />
          <span className="topbar-label">
            NDMU <b>Credentials Dispenser</b>
          </span>
        </header>
        <main className="portal-main">{children}</main>
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
function AdminLogin({ onLogin }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
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
    <main className="admin-login">
      <section className="admin-panel">
        <Brand />
        <span className="mark">MIS ADMINISTRATION</span>
        <h1>Administration portal</h1>
        <p>Sign in using your institutional email.</p>
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
          />
          {error && <p className="error">{error}</p>}
          <button className="btn primary wide">Sign in</button>
        </form>
        <button className="link-button" onClick={() => go("/setup")}>
          First-time setup
        </button>
      </section>
    </main>
  );
}
function Dashboard({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = () =>
    request("/admin/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const credentials = Array.isArray(data?.credentials) ? data.credentials : [];
  const activity = Array.isArray(data?.recentActivity)
    ? data.recentActivity
    : [];
  const vouchers = data?.vouchers || { available: 0, assigned: 0 };
  const kiosks = data?.kiosks || { online: 0, total: 0 };
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Operational overview for the NDMU Credentials Dispenser."
        actions={
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
        }
      />
      {error && <p className="error">{error}</p>}
      {!data ? (
        <p>Loading dashboard...</p>
      ) : (
        <>
          <section className="metric-grid">
            <Metric label="Active students" value={data.activeStudents || 0} />
            <Metric
              label="Available WiFi vouchers"
              value={vouchers.available}
            />
            <Metric label="Assigned WiFi vouchers" value={vouchers.assigned} />
            <Metric
              label="Online kiosks"
              value={`${kiosks.online} / ${kiosks.total}`}
            />
          </section>
          <section className="two-column">
            <article className="panel">
              <h2>Credential coverage</h2>
              {credentials.length ? (
                credentials.map((c) => (
                  <div className="list-row" key={c.credential_type}>
                    <span>{c.credential_type}</span>
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
            <article className="panel">
              <h2>Recent kiosk activity</h2>
              {activity.length ? (
                activity.map((a, i) => (
                  <div className="list-row" key={i}>
                    <span>{a.transaction_type.replace("_", " ")}</span>
                    <small>{new Date(a.created_at).toLocaleString()}</small>
                  </div>
                ))
              ) : (
                <Empty
                  title="No activity yet"
                  detail="Kiosk verification and release events appear here."
                />
              )}
            </article>
          </section>
        </>
      )}
    </>
  );
}
function Metric({ label, value }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
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
              SATP, Schoology, and Kumosoft usernames automatically use the
              School ID.
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
              SATP, Schoology, and Kumosoft usernames automatically use the
              School ID.
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
              <h3>Optional account credentials</h3>
              <p className="form-note">
                SATP, Schoology, and Kumosoft usernames automatically use the
                School ID.
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
  const pick = (next) => {
    setQuery(next);
    const course = courses.find(
      (item) => `${item.code} - ${item.name}` === next,
    );
    onChange(course ? String(course.id) : "");
  };
  return (
    <label className="field course-search-field">
      <span>Course</span>
      <input
        required
        list="student-course-options"
        value={query}
        onChange={(e) => pick(e.target.value)}
        placeholder="Search course code or name"
      />
      <datalist id="student-course-options">
        {courses.map((course) => (
          <option key={course.id} value={`${course.code} - ${course.name}`} />
        ))}
      </datalist>
      {value && <small className="field-hint">Selected course</small>}
    </label>
  );
}
function KioskCourseSelect({ courses, value, onChange }) {
  const selected = courses.find((course) => String(course.id) === String(value));
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
        <span className="kiosk-course-chevron" aria-hidden="true"><AppIcon name="expand_more" size={20} /></span>
        {open && (
          <div className="kiosk-course-results" id="kiosk-course-results" role="listbox">
            {filtered.length ? filtered.map((course) => (
              <button type="button" role="option" aria-selected={String(course.id) === String(value)} key={course.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(course)}>
                <b>{course.code}</b><span>{course.name}</span>
              </button>
            )) : <p>No matching courses found.</p>}
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
                SATP, Schoology, and Kumosoft usernames automatically use the
                School ID.
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
      const response = await fetch(`${API}/admin/course-records/import`, {
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
      const response = await fetch(`${API}/admin/course-records/import`, {
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
  const [file, setFile] = useState(null),
    [validation, setValidation] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(null),
    [confirm, setConfirm] = useState(false);
  const template = () => {
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
  const send = async (endpoint) => {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(
      `${API}/admin/course-records/import${endpoint}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Course import failed.");
    return data;
  };
  const validate = async (e) => {
    e.preventDefault();
    if (!file) return setError("Choose a CSV or Excel file first.");
    setBusy(true);
    setError("");
    try {
      setValidation(await send("/validate"));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await send("");
      onImported();
      onToast?.(
        `${data.inserted} course(s) added and ${data.updated} updated.`,
      );
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const summary = (data) => (
    <div className="validation-summary">
      <span>
        <b>{data.new || data.inserted || 0}</b> new
      </span>
      <span>
        <b>{data.update || data.updated || 0}</b> updates
      </span>
      <span>
        <b>{data.unchanged || 0}</b> unchanged
      </span>
      <span className={data.invalid ? "has-errors" : ""}>
        <b>{data.invalid || 0}</b> errors
      </span>
    </div>
  );
  return (
    <>
      <div className="modal-backdrop" onMouseDown={onClose}>
        <section
          className="course-modal bulk-import-modal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header>
            <div>
              <p className="eyebrow">BULK ACTION</p>
              <h2>Import courses</h2>
            </div>
            <button
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              &times;
            </button>
          </header>
          {done ? (
            <div className="import-result">
              <strong>Import complete</strong>
              {summary(done)}
              {done.errors.slice(0, 5).map((item) => (
                <small key={item.row}>
                  Row {item.row}: {item.message}
                </small>
              ))}
              <Button onClick={onClose}>Done</Button>
            </div>
          ) : validation ? (
            <div className="validation-result">
              <p className="eyebrow">VALIDATION RESULT</p>
              <h3>Review before importing</h3>
              {summary(validation)}
              {validation.preview.length > 0 && (
                <div className="validation-preview">
                  {validation.preview.map((item) => (
                    <p key={item.row}>
                      <b>{item.code}</b>
                      <span>{item.status}</span>
                      {item.name}
                    </p>
                  ))}
                </div>
              )}
              {validation.errors.slice(0, 5).map((item) => (
                <small className="validation-error" key={item.row}>
                  Row {item.row}: {item.message}
                </small>
              ))}
              {error && <p className="error">{error}</p>}
              <footer>
                <Button variant="secondary" onClick={() => setValidation(null)}>
                  Choose another file
                </Button>
                <button
                  disabled={busy || (!validation.new && !validation.update)}
                  onClick={() => setConfirm(true)}
                  className="btn primary"
                >{`Import ${validation.new + validation.update} changes`}</button>
              </footer>
            </div>
          ) : (
            <form onSubmit={validate}>
              <label className="bulk-file-picker">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    setFile(e.target.files[0] || null);
                    setError("");
                  }}
                />
                <span className="upload-icon">⇧</span>
                <b>{file ? file.name : "Choose an Excel file"}</b>
                <small>
                  {file
                    ? "Ready to validate"
                    : "Use the downloadable template for the required columns"}
                </small>
              </label>
              <p className="template-link">
                Need the format?{" "}
                <button type="button" onClick={template}>
                  Download template
                </button>
              </p>
              {error && <p className="error">{error}</p>}
              <footer>
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <button disabled={busy} className="btn primary">
                  {busy ? "Validating..." : "Validate file"}
                </button>
              </footer>
            </form>
          )}
        </section>
      </div>
      {confirm && (
        <ConfirmModal
          title="Import course changes?"
          message={`This will add ${validation.new} new course(s) and update ${validation.update} existing course(s).`}
          confirmLabel="Import changes"
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            importFile();
          }}
        />
      )}{" "}
      {busy && (
        <LoadingModal
          title={validation ? "Importing courses" : "Validating course file"}
          message={
            validation
              ? "Saving approved course changes. Please do not close this page."
              : "Checking the course file for new records, updates, and errors."
          }
        />
      )}
    </>
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
  const [courses, setCourses] = useState([]),
    [editor, setEditor] = useState(null),
    [form, setForm] = useState({ code: "", name: "", isActive: true }),
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
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
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
      setToast("Course saved successfully.");
    } catch (err) {
      setError(err.message);
    }
  };
  const columns = [
    { data: "code" },
    { data: "name" },
    { data: "is_active" },
    null,
  ];
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Courses"
        description="Manage course master data used when students are verified at the kiosk."
        actions={<Button onClick={() => edit(null)}>Add course</Button>}
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
      <section className="panel student-panel courses-data-table">
        <div className="course-intro">
          Courses here appear automatically in the Add Student course selector.
        </div>
        {error && <p className="error">{error}</p>}
        {courses.length ? (
          <DataTable
            data={courses}
            columns={columns}
            slots={{
              0: (data) => <b>{data}</b>,
              2: (data) => (
                <Status tone={data ? "green" : "gold"}>
                  {data ? "Active" : "Inactive"}
                </Status>
              ),
              3: (_data, row) => (
                <Button variant="secondary" onClick={() => edit(row)}>
                  Edit
                </Button>
              ),
            }}
            options={{
              pageLength: 10,
              lengthMenu: [10, 25, 50, 100],
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
                <Status tone={student.is_active ? "green" : "gold"}>
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
                      <small>Username</small>
                      {account.username}
                    </span>
                    <code>
                      <small>Password</small>
                      {account.password}
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
  { id: "courses", title: "Courses", detail: "CourseCode, CourseName", endpoint: "/admin/course-records/import" },
  { id: "students", title: "Students", detail: "SchoolID, LastName, FirstName, MiddleName, BirthDate, and CourseCode", endpoint: "/admin/imports/students" },
  { id: "satp", title: "SATP accounts", detail: "SchoolID and Password", endpoint: "/admin/imports/satp" },
  { id: "schoology", title: "Schoology accounts", detail: "SchoolID and Password", endpoint: "/admin/imports/schoology" },
  { id: "kumosoft", title: "Kumosoft accounts", detail: "SchoolID and Password", endpoint: "/admin/imports/kumosoft" },
  { id: "email", title: "Institutional email", detail: "SchoolID, EmailAddress, and Password", endpoint: "/admin/imports/email" },
  { id: "vouchers", title: "WiFi vouchers", detail: "VoucherCode", endpoint: "/admin/voucher-records/import", xlsxOnly: true },
];

async function downloadImportTemplate(type, token) {
  const response = await adminFetch(`/admin/imports/${type.id}/template`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    let message = "Unable to download the import template.";
    try { message = (await response.json()).message || message; } catch {}
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${type.id}-import-template.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function ImportHubModal({ type, token, onClose, onComplete }) {
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (suffix = "") => {
    const body = new FormData();
    body.append("file", file);
    const response = await adminFetch(`${type.endpoint}${suffix}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Import failed.");
    return data;
  };
  const validate = async (event) => {
    event.preventDefault();
    if (!file) return setError("Choose a file first.");
    setBusy(true);
    setError("");
    try { setValidation(await send("/validate")); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const runImport = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await send();
      const inserted = Number(result.inserted ?? result.added ?? 0);
      const updated = Number(result.updated ?? 0);
      onComplete(`${type.title}: ${inserted} added${updated ? `, ${updated} updated` : ""}.`);
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const invalid = Number(validation?.invalid ?? validation?.errors?.length ?? 0);
  const changes = Number(validation?.new || 0) + Number(validation?.update || 0);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="course-modal bulk-import-modal import-hub-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">BULK IMPORT</p><h2>Import {type.title}</h2></div><button className="modal-close" onClick={onClose} aria-label="Close">&times;</button></header>{validation ? <div className="validation-result"><p className="eyebrow">VALIDATION RESULT</p><h3>Review before importing</h3><div className="validation-summary"><span><b>{validation.new || 0}</b> new</span>{type.id === "vouchers" ? <span><b>{validation.duplicates || 0}</b> duplicates</span> : <span><b>{validation.update || 0}</b> updates</span>}<span className={invalid ? "has-errors" : ""}><b>{invalid}</b> errors</span></div>{validation.errors?.slice(0, 6).map((item) => <small className="validation-error" key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</small>)}{error && <p className="error">{error}</p>}<footer><Button variant="secondary" onClick={() => { setValidation(null); setError(""); }}>Choose another file</Button><button className="btn primary" disabled={busy || invalid > 0 || changes < 1} onClick={runImport}>{busy ? "Importing..." : `Import ${changes} records`}</button></footer></div> : <form onSubmit={validate}><label className="bulk-file-picker"><input type="file" accept={type.xlsxOnly ? ".xlsx" : ".csv,.xlsx,.xls"} onChange={(event) => { setFile(event.target.files?.[0] || null); setError(""); }} /><span className="upload-icon">&#8679;</span><b>{file ? file.name : `Choose ${type.xlsxOnly ? "an Excel" : "a CSV or Excel"} file`}</b><small>{file ? "Ready to validate" : `Required columns: ${type.detail}`}</small></label><p className="template-link">Need the format? <button type="button" onClick={() => downloadImportTemplate(type, token).catch((err) => setError(err.message))}>Download template</button></p>{error && <p className="error">{error}</p>}<footer><Button variant="secondary" onClick={onClose}>Cancel</Button><button className="btn primary" disabled={busy || !file}>{busy ? "Validating..." : "Validate file"}</button></footer></form>}</section></div>;
}

function ImportsPage({ token }) {
  const [activeType, setActiveType] = useState(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);
  const template = (type) => downloadImportTemplate(type, token).catch((err) => setError(err.message));
  return <>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    <PageHeader title="Imports" description="Download the required template, validate your file, and import records in bulk." />
    {error && <p className="error imports-page-error">{error}</p>}
    <section className="import-hub-grid">{importTypes.map((type, index) => <article className="panel import-hub-card" key={type.id}><div className="import-card-icon">{String(index + 1).padStart(2, "0")}</div><div className="import-card-copy"><h2>{type.title}</h2><p>{type.detail}</p><small>{type.xlsxOnly ? "XLSX format" : "CSV or XLSX format"}</small></div><footer><Button variant="secondary" onClick={() => template(type)}>Download template</Button><Button onClick={() => setActiveType(type)}>Upload file</Button></footer></article>)}</section>
    {activeType && <ImportHubModal type={activeType} token={token} onClose={() => setActiveType(null)} onComplete={setToast} />}
  </>;
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
    } catch (err) { setError(err.message); }
    finally { if (!quiet) setLoading(false); }
  };
  useEffect(() => {
    load();
    const timer = setInterval(() => load({ quiet: true }), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); }, [toast]);
  const openKiosk = async (id) => {
    setSelectedId(id);
    setDetailsLoading(true);
    try { setDetails(await request(`/admin/kiosks/${id}`, { headers })); }
    catch (err) { setError(err.message); }
    finally { setDetailsLoading(false); }
  };
  useEffect(() => {
    if (!selectedId && kiosks[0]) openKiosk(kiosks[0].id);
  }, [kiosks]);
  useEffect(() => {
    if (!selectedId) return;
    const refreshDetails = () => request(`/admin/kiosks/${selectedId}`, { headers })
      .then(setDetails)
      .catch((err) => setError(err.message));
    const timer = setInterval(refreshDetails, 30000);
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
    } catch (err) { setError(err.message); setPendingAction(""); }
  };
  const online = kiosks.filter((item) => item.is_online).length;
  const filtered = kiosks.filter((item) => [item.kiosk_name, item.kiosk_code, item.location].filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const selected = details?.kiosk;
  const actionLabel = { reload: "Reload dispenser", restartBrowser: "Restart browser", reboot: "Reboot device", shutdown: "Shut down device" };
  const duration = (seconds) => {
    if (!Number.isFinite(Number(seconds))) return "Not reported";
    const value = Math.max(0, Number(seconds));
    const days = Math.floor(value / 86400), hours = Math.floor((value % 86400) / 3600), minutes = Math.floor((value % 3600) / 60);
    return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`].filter(Boolean).join(" ");
  };
  return <>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    <PageHeader title="Kiosks" description="Monitor dispenser devices that have opened and connected to the system." actions={<Button variant="secondary" onClick={() => load()}><AppIcon name="refresh" /> Refresh</Button>} />
    <section className="student-summary kiosk-admin-summary">
      <article><span>Detected kiosks</span><strong>{kiosks.length}</strong></article>
      <article><span>Online now</span><strong>{online}</strong></article>
      <article><span>Offline</span><strong>{kiosks.length - online}</strong></article>
    </section>
    <section className="panel kiosk-admin-panel">
      <div className="course-intro">This list updates automatically. A kiosk is online when it has authenticated within the last five minutes.</div>
      {error && <p className="error">{error}</p>}
      {loading ? <div className="kiosk-loading" role="status"><span className="loading-spinner" /> Loading kiosks...</div> : kiosks.length ? <><div className="kiosk-monitor-toolbar"><label><AppIcon name="search" size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search kiosks" aria-label="Search kiosks" /></label><small>{filtered.length} of {kiosks.length} devices</small></div><div className="kiosk-admin-table-wrap"><table className="kiosk-admin-table kiosk-monitor-table"><thead><tr><th>Location</th><th>Device</th><th>Status</th><th>Last seen</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className={item.id === selectedId ? "selected" : ""} onClick={() => openKiosk(item.id)}><td>{item.location || <span className="muted-cell">Not reported</span>}</td><td><span className="student-cell"><b>{item.kiosk_name}</b><small>{item.kiosk_code}</small></span></td><td><span className={`kiosk-connection ${item.is_online ? "online" : "offline"}`}><i />{item.is_online ? "Online" : "Offline"}</span></td><td>{item.last_seen ? <span className="request-date"><b>{new Date(item.last_seen).toLocaleDateString()}</b><small>{new Date(item.last_seen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span> : <span className="muted-cell">Never connected</span>}</td></tr>)}</tbody></table></div>{!filtered.length && <p className="kiosk-no-results">No kiosk matches your search.</p>}</> : <Empty title="No kiosk detected" detail="Open the student dispenser on a kiosk device. It will appear here after connecting." />}
    </section>
    {selectedId && <section className="panel kiosk-detail-panel">{detailsLoading || !selected ? <div className="kiosk-loading" role="status"><span className="loading-spinner" /> Loading kiosk details...</div> : <><header><div><p className="eyebrow">KIOSK DETAILS</p><h2>{selected.location || "Kiosk"} — {selected.kiosk_code}</h2><p>{selected.kiosk_name}</p></div><span className={`kiosk-connection ${selected.is_online ? "online" : "offline"}`}><i />{selected.is_online ? "Online" : "Offline"}</span></header><dl className="kiosk-detail-grid"><div><dt>IP address</dt><dd>{selected.ip_address || "Not reported"}</dd></div><div><dt>MAC address</dt><dd>{selected.mac_address || "Not available in browser kiosk"}</dd></div><div><dt>Operating system</dt><dd>{selected.operating_system || "Not reported"}</dd></div><div><dt>Uptime</dt><dd>{duration(selected.uptime_seconds)}</dd></div><div><dt>Browser</dt><dd>{selected.browser_status || "Not reported"}</dd></div><div><dt>Browser status</dt><dd>{selected.is_online ? "Running" : "Not connected"}</dd></div><div><dt>Website</dt><dd>{selected.current_page || "Not reported"}</dd></div><div><dt>Website status</dt><dd>{selected.is_online ? "Reachable" : "Unavailable"}</dd></div><div><dt>Last seen</dt><dd>{selected.last_seen ? new Date(selected.last_seen).toLocaleString() : "Never"}</dd></div></dl><div className="kiosk-command-actions"><Button variant="secondary" onClick={() => setPendingAction("reload")}><AppIcon name="refresh" /> Reload dispenser</Button><Button variant="secondary" onClick={() => setPendingAction("restartBrowser")}><AppIcon name="restart_alt" /> Restart browser</Button><Button variant="secondary" onClick={() => setPendingAction("reboot")}><AppIcon name="restart_alt" /> Reboot</Button><Button variant="secondary" onClick={() => setPendingAction("shutdown")}><AppIcon name="power_settings_new" /> Shut down</Button></div><div className="kiosk-command-note"><AppIcon name="info" size={18} /> Reload and restart run in the browser kiosk. Reboot and shut down require the optional device agent and will be reported as unsupported until it is installed.</div>{details.commands?.length > 0 && <section className="kiosk-command-history"><h3>Recent commands</h3>{details.commands.map((command) => <div key={command.id}><span>{command.command.replace(/_/g, " ")}</span><Status tone={command.status === "COMPLETED" ? "green" : command.status === "UNSUPPORTED" || command.status === "FAILED" ? "danger" : "gold"}>{command.status.toLowerCase()}</Status><small>{command.result_text || new Date(command.created_at).toLocaleString()}</small></div>)}</section>}</>}</section>}
    {pendingAction && <ConfirmModal title={`${actionLabel[pendingAction]}?`} message={pendingAction === "reboot" || pendingAction === "shutdown" ? "This command requires a kiosk device agent. Without one, the kiosk will report the command as unsupported." : "The command will run on the selected kiosk as soon as it checks in."} confirmLabel={actionLabel[pendingAction]} onConfirm={queueAction} onClose={() => setPendingAction("")} />}
  </>;
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

function AdminRedirect({ to, message }) {
  useEffect(() => {
    go(to);
  }, [to]);
  return <main className="admin-login">{message}</main>;
}

function AdminApp() {
  const path = usePath();
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    const updateToken = (event) => setToken(event.detail);
    addEventListener("admin-token-refreshed", updateToken);
    return () => removeEventListener("admin-token-refreshed", updateToken);
  }, []);
  useEffect(() => {
    if (!token) {
      request("/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" } })
        .then((session) => setToken(session.accessToken))
        .catch(() => setChecking(false));
      return;
    }
    request("/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(() => setChecking(false))
      .catch(async (error) => {
        if (error.message === "Authentication required.") {
          try {
            const session = await request("/auth/refresh", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            });
            setToken(session.accessToken);
            return;
          } catch {
            setToken("");
          }
        }
        setChecking(false);
      });
  }, [token]);
  if (checking)
    return (
      <main className="admin-login">
        Checking your administrator session...
      </main>
    );
  if (!token) return <AdminLogin onLogin={setToken} />;
  const content =
    path === "/admin" ? (
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
      <AdminRedirect to="/admin/students" message="Opening student records..." />
    ) : (
      <GenericPage path={pageMeta[path] ? path : "/admin/students"} />
    );
  return (
    <AdminShell
      path={path}
      token={token}
      onLogout={() => {
        request("/auth/logout", { method: "POST" }).catch(() => {});
        setToken("");
        go("/admin");
      }}
    >
      <div className="page-transition" key={path}>
        {content}
      </div>
    </AdminShell>
  );
}

function KioskHeader() {
  return (
    <header className="kiosk-site-header">
      <div className="kiosk-site-brand">
        <img src={ndmuLogo} alt="NDMU seal" />
        <span><b>Notre Dame of Marbel University</b><small>Student WiFi &amp; System Credentials</small></span>
      </div>
      <span className="kiosk-mode">Kiosk</span>
    </header>
  );
}

function KioskFooter() {
  return (
    <footer className="kiosk-site-footer">
      <span>NDMU © {new Date().getFullYear()} | Developed by MIS Department</span>
    </footer>
  );
}

function KioskGuidelines({ guidelines, tip }) {
  const pageSize = 4;
  const pageCount = Math.max(1, Math.ceil(guidelines.length / pageSize));
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    if (pageCount < 2) return undefined;
    const timer = setInterval(() => setPage((current) => (current + 1) % pageCount), 6000);
    return () => clearInterval(timer);
  }, [pageCount]);

  const visibleGuidelines = guidelines.slice(page * pageSize, (page + 1) * pageSize);
  const move = (offset) => setPage((current) => (current + offset + pageCount) % pageCount);

  return (
    <section className="kiosk-card kiosk-guidelines">
      <h2>Credential &amp; Voucher Guidelines</h2>
      <div className="guideline-carousel">
        <div className="guideline-list guideline-slide" key={page} aria-live="polite">
          {visibleGuidelines.map((item) => <article key={item.id}><i /><p><b>{item.title}</b>{item.message && ` ${item.message}`}</p></article>)}
          {!visibleGuidelines.length && <p className="guideline-empty">No guidelines are currently posted.</p>}
        </div>
        {pageCount > 1 && (
          <div className="guideline-carousel-controls" aria-label="Guideline pages">
            <button type="button" onClick={() => move(-1)} aria-label="Previous guidelines"><AppIcon name="keyboard_arrow_up" size={21} /></button>
            <span>{page + 1} / {pageCount}</span>
            <button type="button" onClick={() => move(1)} aria-label="Next guidelines"><AppIcon name="keyboard_arrow_down" size={21} /></button>
          </div>
        )}
      </div>
      {tip && <aside><b>{tip.title}</b><span>{tip.message}</span></aside>}
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
  useEffect(() => {
    let active = true;
    const start = async () => {
      try {
        await request("/kiosk/session", { method: "POST", headers: kioskHeaders });
        if (!active) return;
        setKioskReady(true);
        const [loadedCourses, loadedReminders, loadedControls] = await Promise.all([
          request("/kiosk/courses", { headers: kioskHeaders }),
          request("/kiosk/reminders", { headers: kioskHeaders }),
          request("/kiosk/module-controls", { headers: kioskHeaders }),
        ]);
        if (!active) return;
        setCourses(loadedCourses);
        setReminders(loadedReminders);
        setModuleControls(loadedControls);
      } catch (e) { if (active) setError(e.message); }
    };
    start();
    const loadControls = () => kioskReady && request("/kiosk/module-controls", { headers: kioskHeaders })
      .then(setModuleControls).catch(() => {});
    const controlTimer = setInterval(loadControls, 15000);
    return () => { active = false; clearInterval(controlTimer); };
  }, [kioskReady]);
  useEffect(() => {
    if (!kioskReady) return undefined;
    let active = true;
    const completeCommand = (commandId, status, result) => request("/kiosk/commands/complete", {
      method: "POST",
      headers: kioskHeaders,
      body: JSON.stringify({ commandId, status, result }),
    });
    const heartbeat = async () => {
      try {
        const { commands = [] } = await request("/kiosk/heartbeat", {
          method: "POST",
          headers: kioskHeaders,
          body: JSON.stringify({
            ...kioskIdentity,
            currentPage: location.pathname,
            uptimeSeconds: Math.floor((Date.now() - KIOSK_STARTED_AT) / 1000),
            operatingSystem: navigator.userAgentData?.platform || navigator.platform || "",
          }),
        });
        for (const command of commands) {
          if (!active) return;
          if (["RELOAD", "RESTART_BROWSER"].includes(command.command)) {
            await completeCommand(command.id, "COMPLETED", "The credentials dispenser was reloaded.");
            location.reload();
            return;
          }
          await completeCommand(
            command.id,
            "UNSUPPORTED",
            "This browser kiosk cannot control the device power. Install the kiosk device agent to use this action.",
          );
        }
      } catch {}
    };
    heartbeat();
    const timer = setInterval(heartbeat, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [kioskReady]);
  useEffect(() => {
    if (!resetNotice) return;
    const timer = setTimeout(() => setResetNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [resetNotice]);
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
    Boolean(result?.pendingRequests?.some(
      (item) => item.type === credentialType && item.kind === kind,
    ));
  const markRequestPending = (credentialType, kind) =>
    setResult((current) => {
      const pendingRequests = current.pendingRequests || [];
      return pendingRequests.some((item) => item.type === credentialType && item.kind === kind)
        ? current
        : { ...current, pendingRequests: [...pendingRequests, { type: credentialType, kind }] };
    });
  const requestReset = async (credentialType) => {
    setRequestingReset(credentialType);
    setResetNotice("");
    try {
      const response = await request("/kiosk/password-reset-requests", {
        method: "POST",
        headers: {
          ...kioskHeaders,
          Authorization: `Bearer ${result.sessionToken}`,
        },
        body: JSON.stringify({ credentialType }),
      });
      setResetNotice(response.message);
      markRequestPending(credentialType, "PASSWORD_RESET");
      setResetRequestInfo(null);
    } catch (err) {
      setResetNotice(err.message);
    } finally {
      setRequestingReset("");
    }
  };
  const requestAccount = async (credentialType) => {
    setRequestingReset(credentialType);
    setResetNotice("");
    try {
      const response = await request("/kiosk/account-requests", {
        method: "POST",
        headers: {
          ...kioskHeaders,
          Authorization: `Bearer ${result.sessionToken}`,
        },
        body: JSON.stringify({ credentialType }),
      });
      setResetNotice(response.message);
      markRequestPending(credentialType, "ACCOUNT_CREATION");
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
          ...(response.credentials.find((item) => item.type === credential.type) || {}),
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
      EMAIL: { title: "Email", username: "Email", website: "Google Workspace / Gmail" },
      KUMOSOFT: { title: "Kumosoft", username: "Kumosoft ID", website: "sms.ndmu.edu.ph" },
      SCHOOLOGY: { title: "Schoology", username: "Username", website: "ndmu.schoology.com" },
      SATP: { title: "SATP", username: "Username", website: "satp.ndmu.edu.ph" },
    },
    visibleCredentials = [...(result?.credentials || [])].sort((a, b) => {
      const stateRank = (item) => item.unavailable ? 2 : item.maintenance ? 1 : 0;
      const stateDifference = stateRank(a) - stateRank(b);
      return stateDifference || ["EMAIL", "KUMOSOFT", "SCHOOLOGY", "SATP"].indexOf(a.type) - ["EMAIL", "KUMOSOFT", "SCHOOLOGY", "SATP"].indexOf(b.type);
    }),
    availableCredentialCount = visibleCredentials.filter((item) => !item.unavailable && !item.maintenance).length,
    kioskControl = moduleControls.find((item) => item.module_key === "KIOSK");
  if (kioskControl?.is_maintenance)
    return (
      <div className="kiosk-page">
        <KioskHeader />
        <main className="kiosk-maintenance">
          <span className="maintenance-icon"><AppIcon name="settings" size={34} /></span>
          <p className="eyebrow">TEMPORARILY UNAVAILABLE</p>
          <h1>Dispenser under maintenance</h1>
          <p>The student credentials dispenser is temporarily unavailable. Please try again later or proceed to the ICT/MIS Office.</p>
          <button className="btn secondary" onClick={() => location.reload()}>Check again</button>
        </main>
        <KioskFooter />
      </div>
    );
  if (result)
    return (
      <div className="kiosk-page">
          <KioskHeader />
          <main key="credentials-summary" className="kiosk kiosk-results kiosk-view kiosk-view-summary">
            <header className="credentials-summary-heading">
              <h1>Credentials Summary</h1>
              <p>{availableCredentialCount} of {visibleCredentials.length} account{visibleCredentials.length === 1 ? "" : "s"} available · Passwords are hidden until you tap <b>Show All</b>.</p>
            </header>
            <section className="credential-summary-panel">
              <div>
                <h2>{result.student.fullName}</h2>
                <p><b>Course:</b> {result.student.course}</p>
                <p><b>Student ID:</b> {result.student.studentId}</p>
                {result.voucherState !== "HIDDEN" && <p className="voucher-summary"><b>WiFi Voucher</b><code>{result.voucherState === "MAINTENANCE" ? "Under maintenance" : passwordsVisible ? (result.wifiVoucher || "Pending") : (result.hasWifiVoucher ? "••••••••" : "Pending")}</code>{result.voucherState === "AVAILABLE" && <button type="button" className={`voucher-request-button${requestIsPending("VOUCHER", "VOUCHER_REQUEST") ? " pending" : ""}`} disabled={requestIsPending("VOUCHER", "VOUCHER_REQUEST")} onClick={() => setVoucherRequestOpen(true)}>{requestIsPending("VOUCHER", "VOUCHER_REQUEST") ? "New voucher request pending" : "Request new voucher"}</button>}</p>}
              </div>
              <p><b>Tip:</b> Keep this screen private.</p>
            </section>
            <section className="credential-grid credential-summary-grid">
            {visibleCredentials.map((c) => {
              const meta = accountMeta[c.type] || { title: c.type, username: "Username", website: "" };
              return <article className="credential credential-summary-card" key={c.type}>
                <h2><span>{meta.title}</span><Status tone={c.unavailable || c.maintenance ? "gold" : "green"}>{c.unavailable ? "Not assigned" : c.maintenance ? "Maintenance" : "Available"}</Status></h2>
                {c.maintenance ? <div className="credential-module-maintenance"><b>Temporarily unavailable</b><span>The MIS administrator has placed this account under maintenance.</span></div> : c.unavailable ? <div className="credential-module-unavailable"><b>Account required</b><span>No {meta.title} account is linked to this student.</span><button type="button" className={`btn secondary${requestIsPending(c.type, "ACCOUNT_CREATION") ? " pending" : ""}`} disabled={Boolean(requestingReset) || requestIsPending(c.type, "ACCOUNT_CREATION")} onClick={() => requestAccount(c.type)}>{requestIsPending(c.type, "ACCOUNT_CREATION") ? "Request pending" : requestingReset === c.type ? "Submitting..." : "Request account"}</button></div> : <div className="credential-card-body">
                  <p><b>{meta.username}:</b> <span>{c.username}</span></p>
                  <p className={`credential-password${passwordsVisible ? " visible" : ""}`}><b>Password:</b><code>{passwordsVisible ? c.password : "••••••••"}</code></p>
                  {meta.website && <p className="credential-website"><b>Website:</b> {meta.website}</p>}
                </div>}
                {c.type !== "SATP" && !c.maintenance && !c.unavailable && <button type="button" className={`credential-reset-button${requestIsPending(c.type, "PASSWORD_RESET") ? " pending" : ""}`} disabled={Boolean(requestingReset) || requestIsPending(c.type, "PASSWORD_RESET")} onClick={() => setResetRequestInfo({ type: c.type, title: meta.title })}>
                  {requestIsPending(c.type, "PASSWORD_RESET") ? "Reset request pending" : requestingReset === c.type ? "Submitting..." : "Request password reset"}
                </button>}
              </article>;
            })}
            </section>
            <div className="credential-summary-actions">
              {!passwordsVisible ? <button type="button" className="btn reveal-all-button" disabled={revealing} onClick={() => setConfirmReveal(true)}><AppIcon name="visibility" />{revealing ? "Showing..." : "Show All"}</button> : <button type="button" className="btn reveal-all-button" onClick={() => { setResult({ ...result, credentials: result.credentials.map(({ password: _password, ...credential }) => credential), wifiVoucher: null }); setPasswordsVisible(false); }}><AppIcon name="visibility_off" />Hide All</button>}
              <button type="button" className="btn primary" onClick={() => { setResult(null); setPasswordsVisible(false); setResetNotice(""); }}><AppIcon name="check" />Done</button>
            </div>
          </main>
          <KioskFooter />
        {resetNotice && <Toast message={resetNotice} onClose={() => setResetNotice("")} />}
        {resetRequestInfo && <PasswordResetInfoModal accountTitle={resetRequestInfo.title} submitting={requestingReset === resetRequestInfo.type} onSubmit={() => requestReset(resetRequestInfo.type)} onClose={() => setResetRequestInfo(null)} />}
        {voucherRequestOpen && <VoucherRequestModal reason={voucherRequestReason} submitting={requestingVoucher} onReasonChange={setVoucherRequestReason} onSubmit={requestNewVoucher} onClose={() => { setVoucherRequestOpen(false); setVoucherRequestReason(""); }} />}
        {confirmReveal && <ConfirmModal title="Show all passwords?" message="The passwords will be displayed on screen and this event will be recorded in Transactions. Make sure no one else can see the kiosk." confirmLabel="Show passwords" onConfirm={revealPasswords} onClose={() => setConfirmReveal(false)} />}
      </div>
    );
  return (
    <div className="kiosk-page">
      <KioskHeader />
      <main key="credentials-dispenser" className="kiosk kiosk-landing kiosk-view kiosk-view-dispenser">
        <header className="kiosk-hero">
          <h1>Student Credentials Dispenser</h1>
          <p>Enter your details to view your WiFi and system credentials.</p>
        </header>
        {banner && (
          <section className="kiosk-reminder-banner">
            <div><span>Quick reminder</span><b>{banner.title}</b><small>{banner.message}</small></div>
            <em>Private kiosk · Do not share your credentials.</em>
          </section>
        )}
        <div className="kiosk-content-grid">
          <section className="kiosk-card kiosk-form-card">
            <h2>Student information</h2>
            <form onSubmit={verify}>
              <div className="accepted-id"><b>Accepted ID</b><span>You may enter either your School ID or Kumosoft ID.</span></div>
              <KioskCourseSelect courses={courses} value={form.courseId} onChange={(courseId) => setForm({ ...form, courseId })} />
              <Field label="School ID / Kumosoft ID" value={form.studentId} onChange={(v) => setForm({ ...form, studentId: v })} />
              <div className="kiosk-name-date">
                <Field label="Last name" value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} />
                <Field label="Birthday" type="date" value={form.birthDate} onChange={(v) => setForm({ ...form, birthDate: v })} />
              </div>
              <div className="kiosk-form-actions">
                <button className="btn primary">Submit</button>
                <button type="button" className="btn secondary" onClick={() => { setForm({ studentId: "", lastName: "", birthDate: "", courseId: "" }); setError(""); }}>Clear</button>
              </div>
            </form>
          </section>
          <KioskGuidelines guidelines={guidelines} tip={tip} />
        </div>
      </main>
      <KioskFooter />
      {error && <Toast message={error} tone="error" onClose={() => setError("")} />}
    </div>
  );
}
function ModuleControlsPage({ token }) {
  const [controls, setControls] = useState([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const load = () => request("/admin/module-controls", { headers }).then(setControls).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const update = async (item, values, action) => {
    setBusy(`${item.module_key}-${action}`);
    setError("");
    try {
      const response = await request(`/admin/module-controls/${item.module_key}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      setToast(response.message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };
  const displayName = (key) => key === "VOUCHER" ? "WiFi Voucher" : key.charAt(0) + key.slice(1).toLowerCase();
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader title="Credential visibility controls" description="Choose which credentials students can see and place individual modules or the entire kiosk under maintenance." />
      <section className="panel module-control-panel">
        <div className="course-intro">Disabling a credential removes it from the kiosk. Setting Kiosk maintenance replaces the entire dispenser with a maintenance screen.</div>
        {error && <p className="error">{error}</p>}
        <div className="module-control-table-wrap">
          <table className="module-control-table">
            <thead><tr><th>Credential section</th><th>Visibility</th><th>Maintenance</th><th>Actions</th></tr></thead>
            <tbody>{controls.map((item) => <tr key={item.module_key}><td><b>{displayName(item.module_key)}</b>{item.module_key === "KIOSK" && <small>Controls the complete student dispenser</small>}</td><td>{item.module_key === "KIOSK" ? <span className="muted-cell">Controlled by maintenance</span> : <Status tone={item.is_visible ? "green" : "gold"}>{item.is_visible ? "Enabled" : "Disabled"}</Status>}</td><td><Status tone={item.is_maintenance ? "gold" : "green"}>{item.is_maintenance ? "Maintenance" : "Normal"}</Status></td><td><div className="module-control-actions">{item.module_key !== "KIOSK" && <button className={`btn ${item.is_visible ? "danger" : "primary"}`} disabled={Boolean(busy)} onClick={() => update(item, { isVisible: !item.is_visible }, "visibility")}>{busy === `${item.module_key}-visibility` ? "Saving..." : item.is_visible ? "Disable" : "Enable"}</button>}<button className={`btn ${item.is_maintenance ? "secondary" : "maintenance"}`} disabled={Boolean(busy)} onClick={() => update(item, { isMaintenance: !item.is_maintenance }, "maintenance")}>{busy === `${item.module_key}-maintenance` ? "Saving..." : item.is_maintenance ? "Set normal" : "Set maintenance"}</button></div></td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function TransactionsPage({ token }) {
  const [transactions, setTransactions] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    request("/admin/transactions", { headers: { Authorization: `Bearer ${token}` } })
      .then(setTransactions)
      .catch((err) => setError(err.message));
  }, []);
  const sortedTransactions = [...transactions].sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at) || Number(b.id) - Number(a.id));
  const today = new Date().toDateString();
  return (
    <>
      <PageHeader title="Transactions" description="Review when student passwords were revealed at a kiosk." />
      <section className="student-summary transaction-summary">
        <article><span>Total reveals</span><strong>{transactions.length}</strong></article>
        <article><span>Reveals today</span><strong>{transactions.filter((item) => new Date(item.created_at).toDateString() === today).length}</strong></article>
        <article><span>Students served</span><strong>{new Set(transactions.map((item) => item.student_id).filter(Boolean)).size}</strong></article>
      </section>
      <section className="panel transactions-panel">
        <div className="course-intro">A password reveal is recorded only after the student confirms Show all passwords.</div>
        {error && <p className="error">{error}</p>}
        {transactions.length ? <div className="reset-request-table-wrap"><table className="reset-request-table transactions-table"><thead><tr><th>Student</th><th>Kiosk</th><th>Result</th><th>Date and time</th></tr></thead><tbody>{sortedTransactions.map((item) => <tr key={item.id}><td>{item.student_id ? <span className="student-cell"><b>{[item.first_name, item.middle_name, item.last_name].filter(Boolean).join(" ")}</b><small>{item.student_id}</small></span> : <span className="muted-cell">Unknown student</span>}</td><td>{item.kiosk_code || "—"}</td><td><Status tone="green">Revealed</Status></td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <Empty title="No password reveals yet" detail="A record will appear after a student confirms Show All on the kiosk." />}
      </section>
    </>
  );
}

function RemindersPage({ token }) {
  const emptyForm = { placement: "GUIDELINE", title: "", message: "", sortOrder: 10, isActive: true };
  const [reminders, setReminders] = useState([]),
    [editor, setEditor] = useState(null),
    [form, setForm] = useState(emptyForm),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const load = () => request("/admin/reminders", { headers }).then(setReminders).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const openEditor = (item = null) => {
    setForm(item ? { placement: item.placement, title: item.title, message: item.message || "", sortOrder: item.sort_order, isActive: Boolean(item.is_active) } : { ...emptyForm, sortOrder: (reminders.at(-1)?.sort_order || 0) + 10 });
    setError("");
    setEditor(item || {});
  };
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await request(editor.id ? `/admin/reminders/${editor.id}` : "/admin/reminders", {
        method: editor.id ? "PATCH" : "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, sortOrder: Number(form.sortOrder) }),
      });
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
      <PageHeader title="Kiosk reminders" description="Manage the reminders and guidance displayed on the student kiosk." actions={<Button onClick={() => openEditor()}>Add reminder</Button>} />
      <section className="student-summary reset-request-summary">
        <article><span>Total reminders</span><strong>{reminders.length}</strong></article>
        <article><span>Visible on kiosk</span><strong>{reminders.filter((item) => item.is_active).length}</strong></article>
        <article><span>Hidden reminders</span><strong>{reminders.filter((item) => !item.is_active).length}</strong></article>
      </section>
      <section className="panel reminder-admin-panel">
        <div className="course-intro">Lower order numbers appear first. Banner and tip placements use the first active reminder in their group.</div>
        {error && !editor && <p className="error">{error}</p>}
        {reminders.length ? <div className="reset-request-table-wrap"><table className="reset-request-table reminder-admin-table"><thead><tr><th>Reminder</th><th>Placement</th><th>Order</th><th>Status</th><th>Action</th></tr></thead><tbody>{reminders.map((item) => <tr key={item.id}><td><span className="student-cell"><b>{item.title}</b><small>{item.message || "No supporting text"}</small></span></td><td>{item.placement.charAt(0) + item.placement.slice(1).toLowerCase()}</td><td>{item.sort_order}</td><td><Status tone={item.is_active ? "green" : "gold"}>{item.is_active ? "Visible" : "Hidden"}</Status></td><td><Button variant="secondary" onClick={() => openEditor(item)}>Edit</Button></td></tr>)}</tbody></table></div> : <Empty title="No kiosk reminders" detail="Add a reminder to display guidance on the kiosk." action={<Button onClick={() => openEditor()}>Add reminder</Button>} />}
      </section>
      {editor && <div className="modal-backdrop" onMouseDown={() => setEditor(null)}><section className="course-modal reminder-editor-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">KIOSK CONTENT</p><h2>{editor.id ? "Edit reminder" : "Add reminder"}</h2><p>Control where and how this reminder appears.</p></div><button className="modal-close" onClick={() => setEditor(null)} aria-label="Close">&times;</button></header><form onSubmit={save}><label className="field"><span>Placement</span><select value={form.placement} onChange={(event) => setForm({ ...form, placement: event.target.value })}><option value="BANNER">Quick reminder banner</option><option value="GUIDELINE">Guidelines list</option><option value="TIP">Tip box</option></select></label><Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} /><label className="field"><span>Supporting text (optional)</span><textarea rows="3" maxLength="500" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></label><Field label="Display order" type="number" value={form.sortOrder} onChange={(value) => setForm({ ...form, sortOrder: value })} /><label className="status-toggle"><span><b>Visible on kiosk</b><small>Hidden reminders remain saved for later use.</small></span><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /><i /></label>{error && <p className="error">{error}</p>}<footer><Button variant="secondary" onClick={() => setEditor(null)}>Cancel</Button><button className="btn primary" disabled={saving}>{saving ? "Saving..." : "Save reminder"}</button></footer></form></section></div>}
    </>
  );
}

function PasswordResetRequestsPage({ token }) {
  const [requests, setRequests] = useState([]),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [saving, setSaving] = useState(false),
    [queueFilter, setQueueFilter] = useState("PENDING"),
    [page, setPage] = useState(1),
    [accountRequestForm, setAccountRequestForm] = useState({ emailAddress: "", password: "" });
  const headers = { Authorization: `Bearer ${token}` };
  const load = () =>
    request("/admin/password-reset-requests", { headers })
      .then(setRequests)
      .catch((err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);
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
          body: JSON.stringify(selected.request_kind === "ACCOUNT_CREATION" ? accountRequestForm : {}),
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
        { method: "PATCH", headers },
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
    const statusOrder = Number(b.status === "PENDING") - Number(a.status === "PENDING");
    return statusOrder || new Date(b.requested_at) - new Date(a.requested_at);
  });
  const filteredRequests = queueFilter === "ALL"
    ? orderedRequests
    : queueFilter === "RESOLVED"
      ? orderedRequests.filter((item) => item.status !== "PENDING")
      : orderedRequests.filter((item) => item.status === queueFilter);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const visibleRequests = filteredRequests.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  const changeFilter = (filter) => {
    setQueueFilter(filter);
    setPage(1);
  };
  const reviewRequest = (item) => {
    setError("");
    setAccountRequestForm({ emailAddress: "", password: "" });
    setSelected(item);
  };
  const accountRequestReady = selected?.request_kind !== "ACCOUNT_CREATION" || (
    Boolean(accountRequestForm.password) &&
    (selected.credential_type !== "EMAIL" || Boolean(accountRequestForm.emailAddress.trim()))
  );
  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      <PageHeader
        title="Credential requests"
        description="Process password resets, missing-account requests, and administrator-approved voucher replacements."
        actions={<Button variant="secondary" onClick={load}>Refresh</Button>}
      />
      <section className="student-summary reset-request-summary">
        <article><span>Pending requests</span><strong>{pending}</strong></article>
        <article><span>Password resets</span><strong>{requests.filter((item) => item.status === "PENDING" && item.request_kind === "PASSWORD_RESET").length}</strong></article>
        <article><span>Account requests</span><strong>{requests.filter((item) => item.status === "PENDING" && item.request_kind === "ACCOUNT_CREATION").length}</strong></article>
        <article><span>Voucher requests</span><strong>{requests.filter((item) => item.status === "PENDING" && item.request_kind === "VOUCHER_REQUEST").length}</strong></article>
      </section>
      <section className="panel reset-request-panel">
        <div className="course-intro">
          Password resets use the stored default password. Account requests require creating the missing account. Voucher requests replace the current code only after administrator approval.
        </div>
        {error && <p className="error">{error}</p>}
        <div className="request-queue-toolbar">
          <div className="request-filter-tabs" aria-label="Filter credential requests">
            <button type="button" className={queueFilter === "PENDING" ? "active" : ""} onClick={() => changeFilter("PENDING")}>Pending <span>{pending}</span></button>
            <button type="button" className={queueFilter === "RESOLVED" ? "active" : ""} onClick={() => changeFilter("RESOLVED")}>Resolved <span>{requests.length - pending}</span></button>
            <button type="button" className={queueFilter === "ALL" ? "active" : ""} onClick={() => changeFilter("ALL")}>All <span>{requests.length}</span></button>
          </div>
          <small>Pending first · Newest first</small>
        </div>
        {filteredRequests.length ? (
          <div className="reset-request-table-wrap">
            <table className="reset-request-table">
              <thead><tr><th>Student</th><th>Account</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {visibleRequests.map((item) => (
                  <tr key={item.id} className={item.status === "PENDING" ? "request-row-pending" : ""}>
                    <td><span className="student-cell"><b>{[item.first_name, item.middle_name, item.last_name].filter(Boolean).join(" ")}</b><small>{item.school_id} · {item.course_code}</small></span></td>
                    <td><b>{item.credential_type === "VOUCHER" ? "WiFi Voucher" : item.credential_type}</b><small className="reset-account-username">{item.request_kind === "ACCOUNT_CREATION" ? "Account creation" : item.request_kind === "VOUCHER_REQUEST" ? "Replacement request" : item.account_username || "Password reset"}</small></td>
                    <td><span className="request-date"><b>{new Date(item.requested_at).toLocaleDateString()}</b><small>{new Date(item.requested_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span></td>
                    <td><Status tone={item.status === "PENDING" ? "gold" : item.status === "REJECTED" ? "danger" : "green"}>{item.status === "PENDING" ? "Pending" : item.status === "REJECTED" ? "Rejected" : "Completed"}</Status></td>
                    <td>{item.status === "PENDING" ? <Button variant="secondary" onClick={() => reviewRequest(item)}>Review request</Button> : <span className="muted-cell">{item.resolved_by_name || "Completed"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="request-pagination">
              <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredRequests.length)} of {filteredRequests.length}</span>
              <div>
                <button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)} aria-label="Previous page"><AppIcon name="chevron_left" size={20} /></button>
                <b>Page {page} of {pageCount}</b>
                <button type="button" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)} aria-label="Next page"><AppIcon name="chevron_right" size={20} /></button>
              </div>
            </div>
          </div>
        ) : (
          <Empty title={`No ${queueFilter === "ALL" ? "credential" : queueFilter.toLowerCase()} requests`} detail={queueFilter === "PENDING" ? "There are no requests waiting for administrator action." : "No requests match this queue filter."} />
        )}
      </section>
      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <section className="course-modal reset-request-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">{selected.request_kind === "ACCOUNT_CREATION" ? "ACCOUNT REQUEST" : selected.request_kind === "VOUCHER_REQUEST" ? "VOUCHER REQUEST" : "PASSWORD RESET"}</p><h2>{selected.request_kind === "VOUCHER_REQUEST" ? "New WiFi voucher" : `${selected.credential_type} account`}</h2><p>{selected.first_name} {selected.last_name} · {selected.school_id}</p></div>
              <button className="modal-close" onClick={() => setSelected(null)} aria-label="Close">&times;</button>
            </header>
            <div className="reset-request-details">
              {selected.request_kind === "ACCOUNT_CREATION" ? <><p>Add the new account credentials here. The account will be linked to this student when you complete the request.</p>{selected.credential_type === "EMAIL" && <label className="field"><span>Institutional email address</span><input type="email" required value={accountRequestForm.emailAddress} onChange={(event) => setAccountRequestForm({ ...accountRequestForm, emailAddress: event.target.value })} placeholder="student@ndmu.edu.ph" /></label>}<label className="field"><span>Account password</span><input type="text" required value={accountRequestForm.password} onChange={(event) => setAccountRequestForm({ ...accountRequestForm, password: event.target.value })} placeholder="Enter the account password" /></label>{selected.credential_type !== "EMAIL" && <small className="account-request-username-note">Username: {selected.school_id}</small>}</> : selected.request_kind === "VOUCHER_REQUEST" ? <><label><span>Current voucher</span><code>{selected.account_username || "Unavailable"}</code></label><label><span>Student's reason</span><p className="voucher-request-admin-reason">{selected.request_reason}</p></label><p>Approving releases the current voucher and assigns the next available active voucher. This action cannot be undone from this dialog.</p></> : <><label><span>Username</span><code>{selected.account_username || "Unavailable"}</code></label><label><span>Default password</span><code>{selected.default_password || "Unavailable"}</code></label><Button variant="secondary" onClick={() => navigator.clipboard.writeText(selected.default_password || "").then(() => setToast("Default password copied."))}>Copy default password</Button><p>Use this password when resetting the account in {selected.credential_type}. Complete the request only after the source system accepts the reset.</p></>}
              {error && <p className="error">{error}</p>}
            </div>
            <footer className="reset-request-footer">
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
              {selected.request_kind === "VOUCHER_REQUEST" && <button className="btn danger" disabled={saving} onClick={rejectVoucher}>{saving ? "Saving..." : "Reject request"}</button>}
              <button className="btn primary" disabled={saving || !accountRequestReady || (selected.request_kind === "PASSWORD_RESET" && !selected.default_password)} onClick={complete}>{saving ? "Completing..." : selected.request_kind === "ACCOUNT_CREATION" ? "Create account and complete" : selected.request_kind === "VOUCHER_REQUEST" ? "Approve and assign voucher" : "Mark reset completed"}</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function AdminUsersPage({ token }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState({ firstName: "", middleName: "", lastName: "", username: "", password: "", roleId: "", isActive: true });
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };
  const load = () => Promise.all([request("/admin/admin-users", { headers }), request("/admin/admin-roles", { headers })]).then(([userRows, roleRows]) => { setUsers(userRows); setRoles(roleRows); }).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); }, [toast]);
  const openEditor = (user = null) => {
    const defaultRole = roles.find((role) => role.name === "Super Admin") || roles[0];
    const parts = user ? user.full_name.trim().split(/\s+/) : [];
    const firstName = parts.shift() || "";
    const lastName = parts.length ? parts.pop() : "";
    setForm(user ? { firstName, middleName: parts.join(" "), lastName, username: user.username, password: "", roleId: String(user.role_id), isActive: Boolean(user.is_active) } : { firstName: "", middleName: "", lastName: "", username: "", password: "", roleId: defaultRole ? String(defaultRole.id) : "", isActive: true });
    setError("");
    setEditor(user || {});
  };
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await request(editor.id ? `/admin/admin-users/${editor.id}` : "/admin/admin-users", { method: editor.id ? "PATCH" : "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ ...form, roleId: Number(form.roleId) }) });
      setEditor(null);
      setToast(result.message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return <>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    <PageHeader title="Admin users" description="Create and maintain administrator accounts and access roles." actions={<Button onClick={() => openEditor()}>Add administrator</Button>} />
    <section className="student-summary admin-user-summary"><article><span>Total administrators</span><strong>{users.length}</strong></article><article><span>Active accounts</span><strong>{users.filter((user) => user.is_active).length}</strong></article><article><span>Access roles</span><strong>{roles.length}</strong></article></section>
    <section className="panel student-panel admin-users-data-table"><div className="course-intro">Only active administrators can sign in. Keep at least one Super Admin account active.</div>{error && !editor && <p className="error">{error}</p>}{users.length ? <DataTable data={users} columns={[{ data: null }, { data: "username" }, { data: "role_name" }, { data: "is_active" }, { data: "last_login" }, null]} slots={{ 0: (_data, row) => <span className="student-cell"><b>{row.full_name}</b><small>Added {new Date(row.created_at).toLocaleDateString()}</small></span>, 1: (data) => <span className="admin-email">{data}</span>, 2: (data) => <Status tone={data === "Super Admin" ? "green" : "gold"}>{data}</Status>, 3: (data) => <Status tone={data ? "green" : "gold"}>{data ? "Active" : "Inactive"}</Status>, 4: (data) => data ? new Date(data).toLocaleString() : <span className="muted-cell">Never</span>, 5: (_data, row) => <Button variant="secondary" onClick={() => openEditor(row)}>Edit</Button> }} options={{ pageLength: 10, lengthMenu: [10, 25, 50], order: [[0, "asc"]], language: { search: "Search administrators:", emptyTable: "No administrators found." } }}><thead><tr><th>Administrator</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Action</th></tr></thead></DataTable> : <Empty title="No administrators found" detail="Add an administrator account to begin." action={<Button onClick={() => openEditor()}>Add administrator</Button>} />}</section>
    {editor && (
      <div className="modal-backdrop" onMouseDown={() => setEditor(null)}>
        <section className="course-modal admin-user-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <p className="eyebrow">ACCESS CONTROL</p>
              <h2>{editor.id ? "Edit administrator" : "Add administrator"}</h2>
              <p>{editor.id ? "Update account details, access, or password." : "Create a secure administrator account."}</p>
            </div>
            <button className="modal-close" onClick={() => setEditor(null)} aria-label="Close">&times;</button>
          </header>
          <form onSubmit={save}>
            <div className="admin-name-fields">
              <Field label="Last name" value={form.lastName} onChange={(value) => setForm({ ...form, lastName: value })} />
              <Field label="First name" value={form.firstName} onChange={(value) => setForm({ ...form, firstName: value })} />
              <Field label="Middle name (optional)" value={form.middleName} onChange={(value) => setForm({ ...form, middleName: value })} />
            </div>
            <Field label="Email address" type="email" value={form.username} onChange={(value) => setForm({ ...form, username: value })} />
            <label className="field">
              <span>Access role</span>
              <select required value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}>
                <option value="">Select a role</option>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{editor.id ? "New password (optional)" : "Password"}</span>
              <input type="password" required={!editor.id} minLength={editor.id && !form.password ? undefined : 12} autoComplete="new-password" placeholder={editor.id ? "Leave blank to keep current password" : "Minimum 12 characters"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </label>
            <label className="status-toggle">
              <span><b>Active account</b><small>Inactive administrators cannot sign in.</small></span>
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              <i />
            </label>
            {error && <p className="error">{error}</p>}
            <footer>
              <Button variant="secondary" onClick={() => setEditor(null)}>Cancel</Button>
              <button className="btn primary" disabled={saving}>{saving ? "Saving..." : "Save administrator"}</button>
            </footer>
          </form>
        </section>
      </div>
    )}
  </>;
}

function VoucherRowActions({ vouchers, onSelect }) {
  useEffect(() => {
    const attachActions = () => {
      document.querySelectorAll(".vouchers-data-table tbody tr").forEach((row) => {
        const code = row.cells[0]?.textContent.trim();
        const voucher = vouchers.find((item) => item.voucher_code === code);
        const cell = row.cells[row.cells.length - 1];
        if (!voucher || !cell) return;
        const statusCell = row.cells[2];
        if (!voucher.is_active && statusCell?.dataset.voucherStatus !== "inactive") {
          statusCell.replaceChildren();
          statusCell.dataset.voucherStatus = "inactive";
          const badge = document.createElement("span");
          badge.className = "status voucher-status-inactive";
          badge.textContent = "Inactive";
          statusCell.append(badge);
        }
        if (voucher.is_active && statusCell?.dataset.voucherStatus === "inactive") {
          statusCell.replaceChildren();
          statusCell.dataset.voucherStatus = "active";
          const badge = document.createElement("span");
          badge.className = `status ${voucher.is_assigned ? "gold" : "green"}`;
          badge.textContent = voucher.is_assigned ? "Assigned" : "Available";
          statusCell.append(badge);
        }
        if (cell.dataset.voucherAction === String(voucher.id)) return;
        cell.replaceChildren();
        cell.dataset.voucherAction = String(voucher.id);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn secondary voucher-row-action";
        button.textContent = voucher.is_active ? "Deactivate" : "Activate";
        button.addEventListener("click", () => onSelect(voucher));
        cell.append(button);
      });
    };
    const timer = setTimeout(attachActions, 0);
    const table = document.querySelector(".vouchers-data-table");
    const observer = table && new MutationObserver(attachActions);
    observer?.observe(table, { childList: true, subtree: true });
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [vouchers, onSelect]);
  return null;
}

function ReleaseVouchersPage({ token }) {
  const [quantity, setQuantity] = useState("1"), [preview, setPreview] = useState([]), [released, setReleased] = useState([]), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [toast, setToast] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const codes = released.map((voucher) => voucher.voucher_code).join("\n");
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); }, [toast]);
  const prepare = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setReleased([]);
    try {
      const result = await request(`/admin/voucher-records/release/preview?quantity=${encodeURIComponent(quantity)}`, { headers });
      setPreview(result.vouchers || []);
      if (result.message && result.vouchers?.length !== Number(quantity)) setToast(result.message);
      if (!result.vouchers?.length) setError("There are no available vouchers to release.");
    } catch (err) { setPreview([]); setError(err.message); }
    finally { setBusy(false); }
  };
  const release = async () => {
    setConfirm(false); setBusy(true); setError("");
    try {
      const result = await request("/admin/voucher-records/release", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ voucherIds: preview.map((voucher) => voucher.id) }) });
      setReleased(result.vouchers || []); setPreview([]); setToast(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const copyCodes = async () => {
    try { await navigator.clipboard.writeText(codes); setToast("Released voucher codes copied."); }
    catch { setError("Unable to copy automatically. Select and copy the codes below."); }
  };
  const downloadCodes = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([codes + "\n"], { type: "text/plain;charset=utf-8" }));
    link.download = `released-wifi-vouchers-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  };
  return <>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    <PageHeader title="Release vouchers" description="Set aside available WiFi vouchers for external release. Released codes cannot return to automatic student assignment." />
    {error && <p className="error release-page-error">{error}</p>}
    <section className="release-vouchers-grid">
      <article className="panel release-generator"><div className="release-panel-heading"><AppIcon name="confirmation_number" size={24} /><div><p className="eyebrow">STEP 1</p><h2>Prepare vouchers</h2></div></div><p>Choose how many available voucher codes you need to release.</p><form onSubmit={prepare}><label className="field"><span>Number of vouchers</span><input type="number" min="1" max="1000" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><button className="btn primary wide" disabled={busy}>{busy ? "Preparing..." : "Get vouchers"}</button></form></article>
      <article className="panel release-preview"><div className="release-panel-heading"><AppIcon name="fact_check" size={24} /><div><p className="eyebrow">STEP 2</p><h2>Review and release</h2></div></div>{preview.length ? <><p>{preview.length} voucher{preview.length === 1 ? " is" : "s are"} ready for permanent release.</p><div className="release-code-list">{preview.map((voucher, index) => <code key={voucher.id}><small>{String(index + 1).padStart(2, "0")}</small>{voucher.voucher_code}</code>)}</div><footer><Button variant="secondary" onClick={() => setPreview([])}>Clear</Button><button className="btn primary" disabled={busy} onClick={() => setConfirm(true)}><AppIcon name="assignment_turned_in" /> Release {preview.length} voucher{preview.length === 1 ? "" : "s"}</button></footer></> : <div className="release-empty"><AppIcon name="inventory_2" size={30} /><b>No vouchers prepared</b><span>Generate a list of available codes to review them here.</span></div>}</article>
    </section>
    {released.length > 0 && <section className="panel released-output"><div><p className="eyebrow">RELEASE COMPLETE</p><h2>{released.length} voucher{released.length === 1 ? "" : "s"} released</h2><p>Keep this list secure. These codes are permanently excluded from student assignment.</p></div><div className="released-output-actions"><Button variant="secondary" onClick={copyCodes}><AppIcon name="content_copy" /> Copy codes</Button><Button onClick={downloadCodes}><AppIcon name="download" /> Download .txt</Button></div><textarea readOnly aria-label="Released voucher codes" value={codes} onFocus={(event) => event.target.select()} /></section>}
    {confirm && <ConfirmModal title="Release selected vouchers?" message={`${preview.length} voucher code${preview.length === 1 ? "" : "s"} will be permanently removed from available stock and cannot be assigned to students.`} confirmLabel="Release vouchers" onConfirm={release} onClose={() => setConfirm(false)} />}
  </>;
}

function VouchersPage({ token }) {
  const [vouchers, setVouchers] = useState([]), [importing, setImporting] = useState(false), [file, setFile] = useState(null), [preview, setPreview] = useState(null), [releaseTarget, setReleaseTarget] = useState(null), [statusTarget, setStatusTarget] = useState(null), [statusSelection, setStatusSelection] = useState(null), [error, setError] = useState(""), [toast, setToast] = useState("");
  const headers = { Authorization: `Bearer ${token}` };
  const setAdding = setImporting;
  const load = () => request("/admin/voucher-records", { headers }).then(setVouchers).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); }, [toast]);
  const validateImport = async () => { if (!file) return setError("Choose an XLSX file first."); setError(""); try { const data = new FormData(); data.append("file", file); setPreview(await request("/admin/voucher-records/import/validate", { method: "POST", headers, body: data })); } catch (err) { setError(err.message); } };
  const importFile = async () => { if (!file) return; try { const data = new FormData(); data.append("file", file); const result = await request("/admin/voucher-records/import", { method: "POST", headers, body: data }); setImporting(false); setPreview(null); setFile(null); setToast(`${result.added} voucher${result.added === 1 ? "" : "s"} imported.`); load(); } catch (err) { setError(err.message); } };
  const release = async () => { const voucher = releaseTarget; setReleaseTarget(null); try { const result = await request(`/admin/voucher-records/${voucher.id}/release`, { method: "POST", headers }); setToast(result.message); load(); } catch (err) { setError(err.message); } };
  const updateStatus = async () => { const voucher = statusTarget; setStatusTarget(null); setStatusSelection(null); try { const result = await request(`/admin/voucher-records/${voucher.id}/status`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !voucher.is_active }) }); setToast(result.message); load(); } catch (err) { setError(err.message); } };
  const closeImport = () => { setImporting(false); setFile(null); setPreview(null); setError(""); };
  const downloadTemplate = async () => {
    try {
      const response = await adminFetch("/admin/voucher-records/import/template", { headers });
      if (!response.ok) throw new Error("Unable to download the voucher template.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "wifi-voucher-import-template.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };
  const assigned = vouchers.filter((voucher) => voucher.is_active && voucher.is_assigned).length, available = vouchers.filter((voucher) => voucher.is_active && !voucher.is_assigned && !voucher.is_released).length;
  return <>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
    <PageHeader title="WiFi vouchers" description="Maintain voucher stock and see which student currently holds each voucher." actions={<Button onClick={() => setImporting(true)}>Import XLSX</Button>} />
    <section className="student-summary voucher-summary"><article><span>Total vouchers</span><strong>{vouchers.length}</strong></article><article><span>Available stock</span><strong>{available}</strong></article><article><span>Assigned vouchers</span><strong>{assigned}</strong></article></section>
    <VoucherRowActions vouchers={vouchers} onSelect={setStatusTarget} />
    {vouchers.length > 0 && <section className="panel voucher-status-control"><div><h2>Voucher status</h2><p>Deactivate a voucher to prevent future use. Assigned vouchers are released from the student automatically.</p></div><label><span>Voucher</span><select value={statusSelection?.id || ""} onChange={(event) => setStatusSelection(vouchers.find((voucher) => voucher.id === Number(event.target.value)) || null)}><option value="">Select a voucher</option>{vouchers.map((voucher) => <option key={voucher.id} value={voucher.id}>{voucher.voucher_code} — {voucher.is_active ? "Active" : "Inactive"}{voucher.is_assigned ? ", assigned" : ""}</option>)}</select></label><Button variant="secondary" onClick={() => statusSelection && setStatusTarget(statusSelection)}>{statusSelection?.is_active ? "Deactivate" : "Activate"}</Button></section>}
    <section className="panel student-panel vouchers-data-table"><div className="course-intro">Available vouchers are assigned automatically when an administrator generates one for a student or when a student completes kiosk verification.</div>{error && <p className="error">{error}</p>}{vouchers.length ? <DataTable data={vouchers} columns={[{ data: "voucher_code" }, { data: null }, { data: "is_assigned" }, { data: "assigned_at" }, null]} slots={{ 0: (data) => <code className="voucher-code">{data}</code>, 1: (_data, row) => row.student_id ? <span className="student-cell"><b>{[row.first_name, row.middle_name, row.last_name].filter(Boolean).join(" ")}</b><small>{row.student_id}</small></span> : <span className="muted-cell">Not assigned</span>, 2: (data) => <Status tone={data ? "gold" : "green"}>{data ? "Assigned" : "Available"}</Status>, 3: (data) => data ? new Date(data).toLocaleString() : <span className="muted-cell">—</span>, 4: (_data, row) => row.is_assigned ? <Button variant="secondary" onClick={() => setReleaseTarget(row)}>Release</Button> : <span className="muted-cell">Ready</span> }} options={{ pageLength: 10, lengthMenu: [10, 25, 50, 100], order: [[0, "asc"]], language: { search: "Search vouchers:", emptyTable: "No vouchers found." } }}><thead><tr><th>Voucher code</th><th>Assigned student</th><th>Status</th><th>Assigned at</th><th>Action</th></tr></thead></DataTable> : <Empty title="No vouchers in stock" detail="Add voucher codes before students retrieve credentials." action={<Button onClick={() => setAdding(true)}>Add vouchers</Button>} />}</section>
    {importing && <div className="modal-backdrop" onMouseDown={closeImport}><section className="course-modal bulk-import-modal voucher-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">BULK ACTION</p><h2>Import WiFi vouchers</h2></div><button className="modal-close" onClick={closeImport} aria-label="Close">&times;</button></header>{preview ? <div className="validation-result voucher-validation-result"><p className="eyebrow">VALIDATION RESULT</p><h3>Review before importing</h3><div className="validation-summary"><span><b>{preview.new}</b> new</span><span><b>{preview.duplicates}</b> duplicates</span><span className={preview.errors.length ? "has-errors" : ""}><b>{preview.errors.length}</b> errors</span></div>{preview.errors.slice(0, 5).map((item) => <small className="validation-error" key={item.row}>Row {item.row}: {item.message}</small>)}{error && <p className="error">{error}</p>}<footer><Button variant="secondary" onClick={() => { setPreview(null); setError(""); }}>Choose another file</Button><button disabled={!preview.new || preview.errors.length} onClick={importFile} className="btn primary">Import {preview.new} vouchers</button></footer></div> : <form onSubmit={(event) => { event.preventDefault(); validateImport(); }}><label className="bulk-file-picker"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); setError(""); }} /><span className="upload-icon">&#8679;</span><b>{file ? file.name : "Choose an Excel file"}</b><small>{file ? "Ready to validate" : "Use the downloadable template for the required columns"}</small></label><p className="template-link">Need the format? <button type="button" onClick={downloadTemplate}>Download template</button></p>{error && <p className="error voucher-import-error">{error}</p>}<footer><Button variant="secondary" onClick={closeImport}>Cancel</Button><button disabled={!file} className="btn primary">Validate file</button></footer></form>}</section></div>}
    {releaseTarget && <ConfirmModal title="Release voucher" message={`Release ${releaseTarget.voucher_code}? It will be removed from the assigned student and permanently excluded from automatic stock.`} confirmLabel="Release voucher" onConfirm={release} onClose={() => setReleaseTarget(null)} />}
    {statusTarget && <ConfirmModal title={`${statusTarget.is_active ? "Deactivate" : "Activate"} voucher`} message={statusTarget.is_active ? `Deactivate ${statusTarget.voucher_code}? Any current assignment will be released and cleared from the student's voucher record.` : `Activate ${statusTarget.voucher_code}? It will be available for future assignment.`} confirmLabel={statusTarget.is_active ? "Deactivate voucher" : "Activate voucher"} onConfirm={updateStatus} onClose={() => setStatusTarget(null)} />}
  </>;
}
function App() {
  const path = usePath();
  if (path.startsWith("/setup"))
    return <div className="page-transition" key={path}><SetupPage /></div>;
  if (path.startsWith("/admin")) return <AdminApp />;
  return <div className="page-transition" key={path}><Kiosk /></div>;
}
function StudentsPage({ token }) {
  const [students, setStudents] = useState([]),
    [selected, setSelected] = useState(null),
    [editing, setEditing] = useState(null),
    [adding, setAdding] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    request("/admin/students?page=1&limit=1000&status=all", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => setStudents(data.rows))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const open = (id, edit = false) =>
    request(`/admin/students/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((record) => (edit ? setEditing(record) : setSelected(record)))
      .catch((e) => setError(e.message));
  return (
    <>
      <PageHeader
        title="Students"
        description="Select a student to view or update their profile and linked credentials."
        actions={<Button onClick={() => setAdding(true)}>Add student</Button>}
      />
      <section className="student-summary">
        <article>
          <span>Total students</span>
          <strong>{students.length}</strong>
        </article>
        <article>
          <span>Active students</span>
          <strong>{students.filter((s) => s.is_active).length}</strong>
        </article>
        <article>
          <span>Account types</span>
          <strong>4</strong>
        </article>
      </section>
      <section className="panel student-panel students-data-table">
        {error && <p className="error">{error}</p>}
        <DataTable
          data={students}
          columns={[
            { data: null },
            { data: "student_id" },
            { data: null },
            { data: "is_active" },
            null,
          ]}
          slots={{
            0: (_d, row) => (
              <span className="student-cell">
                <b>
                  {[row.first_name, row.middle_name, row.last_name]
                    .filter(Boolean)
                    .join(" ")}
                </b>
                <small>{row.kumosoft_id || "No Kumosoft ID"}</small>
              </span>
            ),
            2: (_d, row) => (
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
            4: (_d, row) => (
              <span className="row-actions">
                <Button variant="secondary" onClick={() => open(row.id)}>
                  View
                </Button>
                <Button onClick={() => open(row.id, true)}>Edit</Button>
              </span>
            ),
          }}
          options={{
            pageLength: 10,
            lengthMenu: [10, 25, 50, 100],
            order: [[1, "asc"]],
            language: { search: "Search students:" },
          }}
        >
          <thead>
            <tr>
              <th>Student</th>
              <th>School ID</th>
              <th>Course</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
        </DataTable>
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
        onEdit={() => {
          setEditing(selected);
          setSelected(null);
        }}
      />
      {editing && (
        <StudentEditModal
          record={editing}
          token={token}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
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
  const update = (key, value) => setForm({ ...form, [key]: value });
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
                SATP, Schoology, and Kumosoft usernames always use the School
                ID.
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
                fetch(`${API}/auth/logout`, { method: "POST", credentials: "same-origin" }).catch(() => {});
                location.assign("/admin");
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
