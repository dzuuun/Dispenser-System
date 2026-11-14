import assert from "node:assert/strict";
import { after, test } from "node:test";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import { createKioskSession } from "../middleware/kioskAuth.middleware.js";

after(() => pool.end());

function setup(t, initial = []) {
  const rows = initial.map((row) => ({ ...row }));
  t.mock.method(bcrypt, "hash", async () => "test-hash");
  t.mock.method(pool, "execute", async (sql, values) => {
    if (sql.startsWith("SELECT id, kiosk_code"))
      return [rows.filter((row) => row.kiosk_code === values[0])];
    if (sql.startsWith("INSERT INTO kiosks")) {
      if (!rows.some((row) => row.kiosk_code === values[0]))
        rows.push({
          id: rows.length + 1,
          kiosk_code: values[0],
          is_active: 1,
          ip_address: values[4],
        });
      return [{ affectedRows: 1 }];
    }
    throw new Error(sql);
  });
  const login = async (ip, code = config().kioskCode) => {
    const res = {
      statusCode: 200,
      status(value) {
        this.statusCode = value;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      },
      cookie(_name, value) {
        this.token = value;
        return this;
      },
      end() {
        return this;
      },
    };
    await createKioskSession(
      {
        ip,
        headers: {},
        header(name) {
          return name === "x-kiosk-code" ? code : "";
        },
        secure: false,
        protocol: "http",
      },
      res,
      (error) => {
        throw error;
      },
    );
    return res;
  };
  return { rows, login };
}

test("different IPs register separate kiosks and the same IP reuses its kiosk", async (t) => {
  const { rows, login } = setup(t);
  const first = await login("192.168.20.10");
  const second = await login("192.168.20.11");
  const again = await login("::ffff:192.168.20.10");
  assert.equal(rows.length, 2);
  const claims = [first, second, again].map((res) =>
    jwt.verify(res.token, config().accessSecret),
  );
  assert.notEqual(claims[0].kioskId, claims[1].kioskId);
  assert.equal(claims[0].kioskId, claims[2].kioskId);
  assert.notEqual(claims[0].kioskCode, claims[1].kioskCode);
});

test("existing kiosk record stays linked to its last known IP", async (t) => {
  const { rows, login } = setup(t, [
    {
      id: 9,
      kiosk_code: config().kioskCode,
      ip_address: "192.168.20.10",
      is_active: 1,
    },
  ]);
  const existing = await login("192.168.20.10");
  const other = await login("192.168.20.11");
  assert.equal(jwt.verify(existing.token, config().accessSecret).kioskId, 9);
  assert.notEqual(jwt.verify(other.token, config().accessSecret).kioskId, 9);
  assert.equal(rows.length, 2);
});

test("unknown enrollment code and disabled kiosks cannot open a session", async (t) => {
  const { rows, login } = setup(t);
  assert.equal((await login("192.168.20.10", "WRONG")).statusCode, 401);
  await login("192.168.20.10");
  rows[0].is_active = 0;
  assert.equal((await login("192.168.20.10")).statusCode, 401);
  assert.equal(rows.length, 1);
});
