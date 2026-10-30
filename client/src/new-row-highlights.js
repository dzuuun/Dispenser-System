export const NEW_ROW_HIGHLIGHT_MS = 5000;

// IDs increase when records are inserted. Older rows shifting into a paged
// result must not look like new arrivals, even if that row was not seen before.
export function createNewRowHighlighter({
  onChange,
  duration = NEW_ROW_HIGHLIGHT_MS,
  now = Date.now,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
}) {
  let initialized = false;
  let highestId = -1n;
  let snapshotScope;
  let timer = null;
  let disposed = false;
  const highlighted = new Map();
  const emit = () => onChange(new Set(highlighted.keys()));
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const scheduleExpiry = () => {
    if (disposed || timer !== null || !highlighted.size) return;
    const expiresAt = Math.min(...highlighted.values());
    timer = setTimeout(
      () => {
        timer = null;
        const time = now();
        let changed = false;
        for (const [id, expiry] of highlighted) {
          if (expiry <= time) {
            highlighted.delete(id);
            changed = true;
          }
        }
        if (changed) emit();
        scheduleExpiry();
      },
      Math.max(0, expiresAt - now()),
    );
  };

  return {
    update(rows, scope = "") {
      if (disposed) return;
      if (scope !== snapshotScope) {
        snapshotScope = scope;
        initialized = false;
        highestId = -1n;
        stop();
        if (highlighted.size) {
          highlighted.clear();
          emit();
        }
      }
      const previousHighest = highestId;
      const expiresAt = now() + duration;
      let changed = false;
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = String(row?.id ?? "");
        if (!/^\d+$/.test(id)) continue;
        const order = BigInt(id);
        if (initialized && order > previousHighest && !highlighted.has(id)) {
          highlighted.set(id, expiresAt);
          changed = true;
        }
        if (order > highestId) highestId = order;
      }
      initialized = true;
      if (changed) emit();
      scheduleExpiry();
    },
    dispose() {
      disposed = true;
      stop();
      highlighted.clear();
    },
  };
}
