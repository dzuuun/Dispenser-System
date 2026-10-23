import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdminApi } from "../src/admin-api.js";

const json = (body, status = 200) => Response.json(body, { status });
const unauthorized = () => json({ message: "Authentication required." }, 401);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function client(handler) {
  const calls = [], tokens = [], expired = [];
  const api = createAdminApi({
    baseUrl: "/dispenser/api",
    fetchImpl: async (url, options) => {
      calls.push({ path: url.replace("/dispenser/api", ""), ...options });
      return handler(calls.at(-1));
    },
    onToken: (token) => tokens.push(token),
    onExpired: () => expired.push(true),
  });
  return { api, calls, tokens, expired };
}

test("parallel expired table, counter, and export requests share one refresh and retry with fresh authorization", async () => {
  const gate = deferred();
  const { api, calls, tokens } = client((call) => call.path === "/auth/refresh"
    ? gate.promise : call.headers.get("Authorization") === "Bearer fresh" ? json({ ok: true }) : unauthorized());
  api.startSession("expired");
  const paths = ["/admin/students", "/admin/transactions", "/admin/password-reset-requests/pending-count", "/admin/transactions/export"];
  const results = paths.map((path) => api.fetch(path));
  await tick();
  assert.equal(calls.filter((call) => call.path === "/auth/refresh").length, 1);
  gate.resolve(json({ accessToken: "fresh" }));
  assert.ok((await Promise.all(results)).every((response) => response.ok));
  assert.deepEqual(tokens, ["expired", "fresh"]);
  assert.equal(calls.length, paths.length * 2 + 1);
  assert.ok(calls.every((call) => call.credentials === "same-origin"));
});

test("refresh preserves uploaded files, request method, custom headers, and server response", async () => {
  let writes = 0;
  const { api, calls } = client((call) => {
    if (call.path === "/auth/refresh") return json({ accessToken: "fresh" });
    if (call.headers.get("Authorization") !== "Bearer fresh") return unauthorized();
    writes += 1;
    return json({ imported: 500 }, 201);
  });
  api.startSession("expired");
  const body = new FormData();
  body.append("file", new Blob(["sample spreadsheet"]), "students.xlsx");
  const headers = new Headers({ authorization: "Bearer expired", "X-Request-Test": "preserve" });
  const response = await api.fetch("/admin/imports/students", { method: "POST", body, headers });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { imported: 500 });
  assert.equal(writes, 1);
  assert.equal(calls.at(-1).body, body);
  assert.equal(calls.at(-1).method, "POST");
  assert.equal(calls.at(-1).headers.get("X-Request-Test"), "preserve");
  assert.equal(headers.get("Authorization"), "Bearer expired", "Caller headers are never mutated");
});

test("a late 401 reuses the already refreshed token and stale component headers cannot roll it back", async () => {
  const slow = deferred();
  const { api, calls } = client((call) => {
    if (call.path === "/auth/refresh") return json({ accessToken: "fresh" });
    if (call.headers.get("Authorization") === "Bearer fresh") return json({ ok: true });
    return call.path === "/admin/slow" ? slow.promise : unauthorized();
  });
  api.startSession("expired");
  const pending = api.fetch("/admin/slow");
  assert.ok((await api.fetch("/admin/transactions")).ok);
  slow.resolve(unauthorized());
  assert.ok((await pending).ok);
  assert.ok((await api.fetch("/admin/students", { headers: [["authorization", "Bearer expired"]] })).ok);
  assert.equal(calls.filter((call) => call.path === "/auth/refresh").length, 1);
  assert.equal(calls.at(-1).headers.get("Authorization"), "Bearer fresh");
});

test("aborting one caller does not cancel a shared session refresh", async () => {
  const gate = deferred();
  const { api, calls } = client((call) => call.path === "/auth/refresh" ? gate.promise
    : call.headers.get("Authorization") === "Bearer fresh" ? json({ ok: true }) : unauthorized());
  api.startSession("expired");
  const controller = new AbortController();
  const cancelled = api.fetch("/admin/transactions", { signal: controller.signal });
  const remaining = api.fetch("/admin/students");
  const cancelledCheck = assert.rejects(cancelled, { name: "AbortError" });
  await tick();
  controller.abort();
  assert.equal(calls.find((call) => call.path === "/auth/refresh").signal.aborted, false);
  gate.resolve(json({ accessToken: "fresh" }));
  await cancelledCheck;
  assert.ok((await remaining).ok);
});

for (const status of [204, 401, 403]) {
  test(`a refresh response of ${status} ends the session once without retry loops`, async () => {
    const { api, calls, expired } = client((call) => call.path === "/auth/refresh"
      ? status === 204 ? new Response(null, { status }) : json({ message: "Session ended." }, status)
      : unauthorized());
    api.startSession("expired");
    assert.equal((await api.fetch("/admin/students")).status, 401);
    assert.deepEqual(expired, [true]);
    assert.equal(api.getAccessToken(), "");
    await assert.rejects(api.fetch("/admin/students", { headers: { Authorization: "Bearer expired" } }), { status: 401 });
    assert.equal(calls.length, 2);
  });
}

test("permissions, server failures, and network failures are not replayed or treated as logout", async () => {
  for (const status of [403, 409, 500, 503]) {
    const { api, calls, expired } = client(() => json({ message: "Request failed." }, status));
    api.startSession("valid");
    assert.equal((await api.fetch("/admin/students", { method: "POST" })).status, status);
    assert.equal(calls.length, 1);
    assert.equal(api.getAccessToken(), "valid");
    assert.deepEqual(expired, []);
  }
  const { api, calls, expired } = client(() => { throw new TypeError("Network unavailable"); });
  api.startSession("valid");
  await assert.rejects(api.fetch("/admin/students", { method: "POST" }), /Network unavailable/);
  assert.equal(calls.length, 1);
  assert.deepEqual(expired, []);
});

test("a temporary refresh failure preserves the session and the next request can recover", async () => {
  let unavailable = true;
  const { api, expired } = client((call) => call.path === "/auth/refresh"
    ? unavailable ? json({}, 503) : json({ accessToken: "fresh" })
    : call.headers.get("Authorization") === "Bearer fresh" ? json({ ok: true }) : unauthorized());
  api.startSession("expired");
  await assert.rejects(api.fetch("/admin/students"), { status: 503 });
  assert.equal(api.getAccessToken(), "expired");
  assert.deepEqual(expired, []);
  unavailable = false;
  assert.ok((await api.fetch("/admin/students")).ok);
});

test("an unauthorized retry ends the session after exactly one refresh", async () => {
  const { api, calls, expired } = client((call) => call.path === "/auth/refresh" ? json({ accessToken: "fresh" }) : unauthorized());
  api.startSession("expired");
  assert.equal((await api.fetch("/admin/students")).status, 401);
  assert.equal(calls.length, 3);
  assert.deepEqual(expired, [true]);
});

test("logout cancels a refresh and ignores its late response before clearing the cookie", async () => {
  const gate = deferred();
  const { api, calls, tokens, expired } = client((call) => call.path === "/auth/refresh" ? gate.promise
    : call.path === "/auth/logout" ? new Response(null, { status: 204 }) : unauthorized());
  api.startSession("expired");
  const request = api.fetch("/admin/students");
  await tick();
  const signingOut = api.logout();
  assert.equal(calls.find((call) => call.path === "/auth/refresh").signal.aborted, true);
  gate.resolve(json({ accessToken: "too-late" }));
  await Promise.all([request, signingOut]);
  assert.equal(api.getAccessToken(), "");
  assert.equal(calls.at(-1).path, "/auth/logout");
  assert.deepEqual(tokens, ["expired"]);
  assert.deepEqual(expired, []);
});

test("an old request cannot renew or end a newly signed-in administrator's session", async () => {
  const gate = deferred();
  const { api, calls, expired } = client(() => gate.promise);
  api.startSession("old-admin");
  const pending = api.fetch("/admin/students", { method: "POST" });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  api.startSession("new-admin");
  gate.resolve(unauthorized());
  await rejected;
  assert.equal(api.getAccessToken(), "new-admin");
  assert.equal(calls.length, 1);
  assert.deepEqual(expired, []);
});

test("kiosk and login requests keep their own authentication and never renew the admin session", async () => {
  const { api, calls } = client(() => unauthorized());
  api.startSession("admin-token");
  await api.fetch("/kiosk/credentials", { headers: { Authorization: "Bearer student-token" } });
  await api.fetch("/auth/login", { method: "POST" });
  assert.equal(calls[0].headers.Authorization, "Bearer student-token");
  assert.equal(calls.length, 2);
});

test("restoring without a cookie safely returns the login state and can be followed by sign-in", async () => {
  const { api, expired } = client(() => new Response(null, { status: 204 }));
  assert.equal(await api.restoreSession(), null);
  assert.deepEqual(expired, []);
  api.startSession("signed-in");
  assert.equal(api.getAccessToken(), "signed-in");
});
