import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNewRowHighlighter,
  NEW_ROW_HIGHLIGHT_MS,
} from "../src/new-row-highlights.js";

function setup() {
  let time = 0;
  let sequence = 0;
  const timers = new Map();
  const changes = [];
  const tracker = createNewRowHighlighter({
    now: () => time,
    onChange: (ids) => changes.push([...ids]),
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    tracker, timers, changes,
    get ids() { return changes.at(-1) || []; },
    advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      time = end;
    },
  };
}
const rows = (...ids) => ids.map((id) => ({ id }));

test("initial records are a baseline and only subsequent higher IDs are highlighted", () => {
  const store = setup();
  store.tracker.update(rows(10, 9, 8));
  assert.deepEqual(store.ids, []);
  assert.equal(store.timers.size, 0);
  store.tracker.update(rows(11, 10, 9));
  assert.deepEqual(store.ids, ["11"]);
  assert.equal(store.timers.size, 1);
});

test("a first entry arriving in an initially empty table is highlighted", () => {
  const store = setup();
  store.tracker.update([]);
  store.tracker.update(rows(1));
  assert.deepEqual(store.ids, ["1"]);
});

test("several new entries arriving in the same poll all receive a highlight", () => {
  const store = setup();
  store.tracker.update(rows(10));
  store.tracker.update(rows(12, 11, 12, 10));
  assert.deepEqual(store.ids, ["12", "11"]);
});

test("repeat polls and updates to existing records do not restart the fade", () => {
  const store = setup();
  store.tracker.update(rows(10));
  store.tracker.update(rows(11, 10));
  store.advance(3000);
  store.tracker.update([{ id: 11, status: "COMPLETED" }, { id: 10 }]);
  assert.equal(store.changes.length, 1);
  store.advance(NEW_ROW_HIGHLIGHT_MS - 3000);
  assert.deepEqual(store.ids, []);
  assert.equal(store.timers.size, 0);
  store.tracker.update(rows(11, 10));
  assert.deepEqual(store.ids, []);
});

test("an older row shifted into a paginated response is never called new", () => {
  const store = setup();
  store.tracker.update(rows(20, 19));
  store.tracker.update(rows(18, 17));
  store.tracker.update(rows(20, 16));
  assert.deepEqual(store.ids, []);
  assert.equal(store.changes.length, 0);
});

test("overlapping arrivals retain their own five-second deadlines", () => {
  const store = setup();
  store.tracker.update(rows(10));
  store.tracker.update(rows(11));
  store.advance(3000);
  store.tracker.update(rows(12, 11));
  assert.deepEqual(store.ids, ["11", "12"]);
  assert.equal(store.timers.size, 1);
  store.advance(2000);
  assert.deepEqual(store.ids, ["12"]);
  store.advance(3000);
  assert.deepEqual(store.ids, []);
  assert.equal(store.timers.size, 0);
});

test("changing the snapshot scope clears highlights and establishes a new baseline", () => {
  const store = setup();
  store.tracker.update(rows(10), "period-1");
  store.tracker.update(rows(11), "period-1");
  store.tracker.update(rows(500, 499), "period-2");
  assert.deepEqual(store.ids, []);
  assert.equal(store.timers.size, 0);
  store.tracker.update(rows(501, 500), "period-2");
  assert.deepEqual(store.ids, ["501"]);
});

test("IDs beyond JavaScript's safe integer range are compared exactly", () => {
  const store = setup();
  store.tracker.update(rows("9007199254740992"));
  store.tracker.update(rows("9007199254740993", "9007199254740992"));
  assert.deepEqual(store.ids, ["9007199254740993"]);
});

test("numeric and string representations of the same ID are not new entries", () => {
  const store = setup();
  store.tracker.update(rows(10));
  store.tracker.update(rows("10"));
  assert.deepEqual(store.ids, []);
});

test("missing and malformed IDs do not create highlights or break refreshing", () => {
  const store = setup();
  store.tracker.update(rows(10));
  store.tracker.update([null, {}, { id: "not-an-id" }, { id: -1 }, { id: 1.5 }]);
  assert.deepEqual(store.ids, []);
  store.tracker.update(rows(11));
  assert.deepEqual(store.ids, ["11"]);
});

test("disposing stops timers and ignores late network responses", () => {
  const store = setup();
  store.tracker.update(rows(10));
  store.tracker.update(rows(11));
  const count = store.changes.length;
  store.tracker.dispose();
  assert.equal(store.timers.size, 0);
  store.advance(10000);
  store.tracker.update(rows(12));
  assert.equal(store.changes.length, count);
});
