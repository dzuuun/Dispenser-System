import assert from "node:assert/strict";
import { test } from "node:test";
import { createPendingRequestTitle } from "../src/pending-request-title.js";

function setup() {
  const document = { title: "NDMU Credentials Dispenser" };
  const timers = new Map();
  let sequence = 0;
  const title = createPendingRequestTitle({
    document,
    setInterval(callback, delay) {
      assert.equal(delay, 1000);
      const id = ++sequence;
      timers.set(id, callback);
      return id;
    },
    clearInterval: (id) => timers.delete(id),
  });
  return { title, document, timers, tick: () => { for (const callback of timers.values()) callback(); } };
}

test("initial pending count appears in the tab without treating old requests as new", () => {
  const { title, document, timers } = setup();
  title.update({ count: 3, latestPendingId: "10" });
  assert.equal(document.title, "(3) NDMU Credentials Dispenser");
  assert.equal(timers.size, 0);
});

test("a new request flashes the pending number and repeated polling does not add timers", () => {
  const { title, document, timers, tick } = setup();
  title.update({ count: 0, latestPendingId: "0" });
  title.update({ count: 1, latestPendingId: "1" });
  assert.equal(document.title, "(1) Pending requests");
  tick();
  assert.equal(document.title, "NDMU Credentials Dispenser");
  title.update({ count: 1, latestPendingId: "1" });
  assert.equal(timers.size, 1);
  assert.equal(document.title, "NDMU Credentials Dispenser");
  tick();
  assert.equal(document.title, "(1) Pending requests");
});

test("an incoming request is detected even if a resolution leaves the pending total unchanged", () => {
  const { title, document, timers } = setup();
  title.update({ count: 3, latestPendingId: "9007199254740992" });
  title.update({ count: 3, latestPendingId: "9007199254740993" });
  assert.equal(document.title, "(3) Pending requests");
  assert.equal(timers.size, 1);
});

test("visiting the foreground request queue acknowledges the alert until another request arrives", () => {
  const { title, document, timers } = setup();
  title.update({ count: 1, latestPendingId: "1" });
  title.update({ count: 2, latestPendingId: "2" });
  title.acknowledge();
  assert.equal(document.title, "(2) NDMU Credentials Dispenser");
  assert.equal(timers.size, 0);
  title.update({ count: 3, latestPendingId: "3" }, true);
  assert.equal(timers.size, 0);
  title.update({ count: 4, latestPendingId: "4" });
  assert.equal(document.title, "(4) Pending requests");
});

test("resolutions update the count and zero pending restores the original title", () => {
  const { title, document, timers, tick } = setup();
  title.update({ count: 2, latestPendingId: "2" });
  title.update({ count: 3, latestPendingId: "3" });
  title.update({ count: 1, latestPendingId: "1" });
  assert.equal(document.title, "(1) Pending requests");
  title.update({ count: 0, latestPendingId: "0" });
  assert.equal(document.title, "NDMU Credentials Dispenser");
  assert.equal(timers.size, 0);
  tick();
  assert.equal(document.title, "NDMU Credentials Dispenser");
  title.update({ count: 1, latestPendingId: "1" });
  assert.equal(timers.size, 1, "a count increase still detects requests on an older API");
});

test("logout clears the animation and prevents a late response from changing the title", () => {
  const { title, document, timers, tick } = setup();
  title.update({ count: 1, latestPendingId: "1" });
  title.update({ count: 2, latestPendingId: "2" });
  title.dispose();
  assert.equal(document.title, "NDMU Credentials Dispenser");
  assert.equal(timers.size, 0);
  title.update({ count: 3, latestPendingId: "3" });
  title.acknowledge();
  tick();
  assert.equal(document.title, "NDMU Credentials Dispenser");
});
