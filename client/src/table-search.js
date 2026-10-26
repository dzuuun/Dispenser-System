export function dateSearchText(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.toLocaleString(),
    date.toLocaleDateString(),
    date.toLocaleTimeString(),
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  ].join(" ");
}

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function matchesTableSearch(query, values) {
  return normalize(values.filter((value) => value != null).join(" ")).includes(
    normalize(query),
  );
}

export function kioskSearchValues(kiosk) {
  const state = kiosk.usage_status || (kiosk.is_online ? "UNKNOWN" : "OFFLINE");
  const labels = {
    IN_USE: "In use",
    IDLE: "Idle",
    UNKNOWN: "Unknown",
    OFFLINE: "Offline",
  };
  return [
    kiosk.location || "Unassigned",
    kiosk.kiosk_name,
    kiosk.is_online ? "Online" : "Offline",
    labels[state] || "Unknown",
    state === "IN_USE"
      ? kiosk.activity_state === "VIEWING_CREDENTIALS"
        ? "Viewing credentials"
        : "Entering details"
      : "",
    kiosk.last_seen ? dateSearchText(kiosk.last_seen) : "Never connected",
  ];
}
