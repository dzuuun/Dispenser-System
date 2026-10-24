// Expressions are application-owned SQL; search text is always bound separately.
export function tableSearch(value, fields) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string" || value.length > 200)
    throw Object.assign(new Error("Search must be 200 characters or fewer."), {
      status: 400,
    });
  const term = value.trim().replace(/\s+/g, " ");
  const pattern = `%${term.replace(/[!%_]/g, "!$&")}%`;
  return {
    term,
    sql: term
      ? `(${fields.map((field) => `${field} LIKE ? ESCAPE '!'`).join(" OR ")})`
      : "",
    values: term ? fields.map(() => pattern) : [],
  };
}

export function dateSearchFields(column, { minuteOnly = false } = {}) {
  // MySQL sessions use UTC+08:00, matching the kiosk's displayed local dates.
  const time = minuteOnly ? "%h:%i %p" : "%l:%i:%s %p";
  return [
    "%Y-%m-%d %H:%i:%s",
    `%c/%e/%Y, ${time}`,
    `%c/%e/%Y ${time}`,
    `%m/%d/%Y ${time}`,
    `%e/%c/%Y ${time}`,
    `%d/%m/%Y ${time}`,
    time,
  ].map((format) => `DATE_FORMAT(${column}, '${format}')`);
}
