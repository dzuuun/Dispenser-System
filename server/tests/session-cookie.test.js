import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { sessionCookieOptions } from "../services/session-cookie.service.js";

test("cookie protocol follows the connection rather than NODE_ENV, retaining HttpOnly and SameSite", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    for (const [secure, path] of [
      [false, "/dispenser/api/auth"],
      [true, "/dispenser/api/auth"],
      [false, "/dispenser/api/kiosk"],
    ]) {
      const options = sessionCookieOptions({ secure }, path, 60_000);
      assert.deepEqual(options, {
        secure,
        path,
        httpOnly: true,
        sameSite: "strict",
        maxAge: 60_000,
      });
      const clear = sessionCookieOptions({ secure }, path);
      assert.equal(clear.secure, secure);
      assert.ok(!("maxAge" in clear));
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("HTTP and trusted HTTPS proxy requests issue and clear cookies with matching flags", async (t) => {
  const app = express();
  app.set("trust proxy", "loopback");
  app.get("/cookie", (req, res) => {
    const options = sessionCookieOptions(req, "/dispenser/api/auth", 60_000);
    res
      .cookie("test_session", "test-value", options)
      .json({ secure: req.secure });
  });
  app.get("/logout", (req, res) =>
    res
      .clearCookie(
        "test_session",
        sessionCookieOptions(req, "/dispenser/api/auth"),
      )
      .end(),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  for (const scheme of ["http", "https"]) {
    const headers = { "X-Forwarded-Proto": scheme };
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/cookie`,
      { headers },
    );
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/dispenser\/api\/auth/);
    assert.equal(/; Secure/.test(cookie), scheme === "https");
    const logout = await fetch(
      `http://127.0.0.1:${server.address().port}/logout`,
      { headers },
    );
    assert.equal(
      /; Secure/.test(logout.headers.get("set-cookie")),
      scheme === "https",
    );
    assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  }
});
