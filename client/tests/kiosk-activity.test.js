import assert from "node:assert/strict";
import { test } from "node:test";
import { createKioskActivityTracker } from "../src/kiosk-activity.js";

function setup() {
  let now = 1000;
  return {
    tracker: createKioskActivityTracker(() => now),
    advance: (ms) => {
      now += ms;
    },
  };
}

test("an open kiosk starts idle until someone interacts", () => {
  const { tracker, advance } = setup();
  advance(60_000);
  assert.deepEqual(tracker.snapshot(), { state: "IDLE", idleMs: null });
  assert.equal(tracker.interact(), true);
  assert.deepEqual(tracker.snapshot(), {
    state: "ENTERING_DETAILS",
    idleMs: 0,
  });
});

test("typing keeps the kiosk in use and 30 seconds without interaction becomes idle", () => {
  const { tracker, advance } = setup();
  tracker.interact();
  advance(29_999);
  assert.equal(tracker.snapshot().state, "ENTERING_DETAILS");
  assert.equal(tracker.interact(), false);
  advance(29_999);
  assert.equal(tracker.snapshot().state, "ENTERING_DETAILS");
  advance(1);
  assert.deepEqual(tracker.snapshot(), { state: "IDLE", idleMs: null });
  assert.equal(tracker.interact(), true);
});

test("opening credentials starts activity without every result update resetting the idle timeout", () => {
  const { tracker, advance } = setup();
  tracker.setViewing(true);
  assert.deepEqual(tracker.snapshot(), {
    state: "VIEWING_CREDENTIALS",
    idleMs: 0,
  });
  advance(20_000);
  tracker.setViewing(true);
  advance(10_000);
  assert.equal(tracker.snapshot().state, "IDLE");
  tracker.interact();
  assert.equal(tracker.snapshot().state, "VIEWING_CREDENTIALS");
});

test("closing credentials clears activity and the next interaction starts a new student entry", () => {
  const { tracker } = setup();
  tracker.setViewing(true);
  tracker.setViewing(false);
  assert.equal(tracker.snapshot().state, "IDLE");
  tracker.interact();
  assert.equal(tracker.snapshot().state, "ENTERING_DETAILS");
  assert.deepEqual(Object.keys(tracker.snapshot()), ["state", "idleMs"]);
});
