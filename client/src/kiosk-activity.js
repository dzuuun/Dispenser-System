export const KIOSK_IDLE_MS = 30_000;

// Use elapsed browser time rather than the device's wall clock.
export function createKioskActivityTracker(now = () => performance.now()) {
  let lastInteraction = null;
  let viewing = false;
  const snapshot = () => {
    const idleMs = lastInteraction === null ? null : Math.max(0, now() - lastInteraction);
    if (idleMs === null || idleMs >= KIOSK_IDLE_MS)
      return { state: "IDLE", idleMs: null };
    return {
      state: viewing ? "VIEWING_CREDENTIALS" : "ENTERING_DETAILS",
      idleMs: Math.floor(idleMs),
    };
  };
  return {
    snapshot,
    interact() {
      const previous = snapshot().state;
      lastInteraction = now();
      return snapshot().state !== previous;
    },
    setViewing(value) {
      if (viewing === value) return;
      viewing = value;
      lastInteraction = value ? now() : null;
    },
  };
}
