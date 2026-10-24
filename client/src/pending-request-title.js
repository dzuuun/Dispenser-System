export function createPendingRequestTitle({
  document,
  setInterval = globalThis.setInterval,
  clearInterval = globalThis.clearInterval,
}) {
  const originalTitle = document.title;
  let previousCount = null;
  let highestId = 0n;
  let count = 0;
  let flashing = false;
  let showCount = true;
  let timer = null;
  let disposed = false;

  const paint = () => {
    document.title = flashing
      ? showCount
        ? `(${count}) Pending requests`
        : originalTitle
      : count
        ? `(${count}) ${originalTitle}`
        : originalTitle;
  };
  const stop = () => {
    flashing = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  return {
    update(snapshot, acknowledged = false) {
      if (disposed) return;
      const next = Number(snapshot.count);
      count = Number.isSafeInteger(next) && next > 0 ? next : 0;
      const rawId = String(snapshot.latestPendingId ?? "0");
      const latestId = /^\d+$/.test(rawId) ? BigInt(rawId) : 0n;
      const isNew =
        previousCount !== null &&
        (count > previousCount || latestId > highestId);
      previousCount = count;
      if (latestId > highestId) highestId = latestId;
      if (!count || acknowledged) {
        stop();
      } else if (isNew) {
        flashing = true;
        showCount = true;
        if (timer === null)
          timer = setInterval(() => {
            showCount = !showCount;
            paint();
          }, 1000);
      }
      paint();
    },
    acknowledge() {
      if (disposed) return;
      stop();
      paint();
    },
    dispose() {
      disposed = true;
      stop();
      document.title = originalTitle;
    },
  };
}
