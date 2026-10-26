import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import { adminRouter } from "../routes/admin.routes.js";
import { kioskHeartbeat } from "../controllers/kiosk-admin.controller.js";

after(() => pool.end());

async function setup(t) {
  const kiosks = new Map([
    [5, { id: 5, location: "Unassigned", is_active: 1 }],
    [6, { id: 6, location: "Library", is_active: 1 }],
    [7, { id: 7, location: "Old location", is_active: 0 }],
  ]);
  const calls = [];
  let role = "Super Admin";
  t.mock.method(pool, "execute", async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes("FROM admin_users"))
      return [[{ id: 1, is_active: 1, role_name: role }]];
    if (sql.startsWith("SELECT id, location FROM kiosks")) {
      assert.match(sql, /WHERE id=\? AND is_active=1$/);
      const kiosk = kiosks.get(Number(values[0]));
      return [kiosk?.is_active ? [{ ...kiosk }] : []];
    }
    if (sql.startsWith("UPDATE kiosks SET location=")) {
      assert.equal(sql, "UPDATE kiosks SET location=? WHERE id=? AND is_active=1");
      const kiosk = kiosks.get(Number(values[1]));
      if (!kiosk?.is_active) return [{ affectedRows: 0 }];
      kiosk.location = values[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const send = async (id, body, { authenticated = true, asRole = "Super Admin" } = {}) => {
    role = asRole;
    const headers = { "Content-Type": "application/json" };
    if (authenticated)
      headers.Authorization = `Bearer ${jwt.sign({ sub: 1 }, config().accessSecret, { expiresIn: "5m" })}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/kiosks/${encodeURIComponent(id)}/location`, {
      method: "PATCH", headers, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { kiosks, calls, send };
}

test("super administrators can set and edit a kiosk location without changing another kiosk", async (t) => {
  const { send, kiosks, calls } = await setup(t);
  const result = await send(5, { location: "  ICT/MIS Office  ", is_active: 0, kioskId: 6 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { id: 5, location: "ICT/MIS Office", message: "Kiosk location saved." });
  assert.equal(kiosks.get(5).location, "ICT/MIS Office");
  assert.equal(kiosks.get(5).is_active, 1);
  assert.equal(kiosks.get(6).location, "Library");
  const edited = await send(5, { location: "Registrar's Office" });
  assert.equal(edited.status, 200);
  assert.equal(kiosks.get(5).location, "Registrar's Office");
  assert.deepEqual(calls.find(({ sql }) => sql.startsWith("UPDATE kiosks")).values, ["ICT/MIS Office", 5]);
  assert.ok(calls.some(({ sql, values }) => sql.startsWith("INSERT INTO audit_logs") && values[1] === "UPDATE_LOCATION" && values[2] === "KIOSK" && values[3] === "5"));
});

test("saving an unchanged location succeeds without a redundant write", async (t) => {
  const { send, calls } = await setup(t);
  assert.equal((await send(6, { location: "Library" })).status, 200);
  assert.equal(calls.filter(({ sql }) => sql.startsWith("UPDATE kiosks")).length, 0);
});

test("location requires an authenticated super administrator", async (t) => {
  const { send, calls } = await setup(t);
  assert.equal((await send(5, { location: "Library" }, { authenticated: false })).status, 401);
  for (const asRole of ["Admin", "Request Staff"])
    assert.equal((await send(5, { location: "Library" }, { asRole })).status, 403);
  assert.equal(calls.filter(({ sql }) => sql.includes("kiosks") || sql.includes("audit_logs")).length, 0);
});

test("blank, malformed and oversized locations fail before accessing kiosk records", async (t) => {
  const { send, calls } = await setup(t);
  for (const location of [undefined, null, "", "   ", 123, true, {}, [], "x".repeat(161)])
    assert.equal((await send(5, { location })).status, 400);
  assert.equal(calls.filter(({ sql }) => sql.includes("kiosks") || sql.includes("audit_logs")).length, 0);
});

test("unknown and inactive kiosks are not modified", async (t) => {
  const { send, calls, kiosks } = await setup(t);
  for (const id of [7, 999]) assert.equal((await send(id, { location: "Library" })).status, 404);
  assert.equal(kiosks.get(7).location, "Old location");
  assert.equal(calls.filter(({ sql }) => sql.startsWith("UPDATE") || sql.includes("audit_logs")).length, 0);
});

test("invalid kiosk IDs cannot reach a kiosk query", async (t) => {
  const { send, calls } = await setup(t);
  for (const id of ["0", "-1", "5.1", "not-an-id", "5 OR 1=1"])
    assert.equal((await send(id, { location: "Library" })).status, 400);
  assert.equal(calls.filter(({ sql }) => sql.includes("kiosks")).length, 0);
});

test("maximum length and literal SQL characters are saved as bound location values", async (t) => {
  const { send, calls, kiosks } = await setup(t);
  const location = "Building 'A'; -- ".padEnd(160, "x");
  assert.equal(location.length, 160);
  assert.equal((await send(5, { location })).status, 200);
  assert.equal(kiosks.get(5).location, location);
  const update = calls.find(({ sql }) => sql.startsWith("UPDATE kiosks"));
  assert.ok(!update.sql.includes(location));
  assert.deepEqual(update.values, [location, 5]);
});

test("heartbeat location is only a default for unassigned kiosks and cannot overwrite a saved location", async (t) => {
  const calls = [];
  t.mock.method(pool, "execute", async (sql, values) => {
    calls.push({ sql, values });
    return sql.startsWith("SELECT") ? [[]] : [{ affectedRows: 1 }];
  });
  await kioskHeartbeat({
    kioskId: 5, headers: {}, socket: {}, get: () => "Chrome",
    body: { location: "Old build location", activity: { state: "IDLE" } },
  }, { set() { return this; }, json() {} });
  const update = calls[0];
  assert.match(update.sql, /location=CASE WHEN location IS NULL OR TRIM\(location\) IN \('', 'Unassigned'\)\s+THEN COALESCE\(\?, location\) ELSE location END/);
  assert.equal(update.values[7], "Old build location");
  assert.equal(update.values.at(-1), 5);
});
