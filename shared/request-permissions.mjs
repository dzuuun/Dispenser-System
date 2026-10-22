export const REQUEST_PERMISSION_GROUPS = [
  {
    type: "EMAIL",
    label: "Email",
    kinds: ["PASSWORD_RESET", "ACCOUNT_CREATION"],
  },
  {
    type: "KUMOSOFT",
    label: "Kumosoft",
    kinds: ["PASSWORD_RESET", "ACCOUNT_CREATION"],
  },
  {
    type: "SCHOOLOGY",
    label: "Schoology",
    kinds: ["PASSWORD_RESET", "ACCOUNT_CREATION"],
  },
  {
    type: "SATP",
    label: "SATP",
    kinds: ["PASSWORD_RESET", "ACCOUNT_CREATION"],
  },
  { type: "VOUCHER", label: "WiFi voucher", kinds: ["VOUCHER_REQUEST"] },
];
export const REQUEST_PERMISSION_KEYS = REQUEST_PERMISSION_GROUPS.flatMap(
  ({ type, kinds }) => kinds.map((kind) => `${type}:${kind}`),
);
export function validateRequestPermissions(value) {
  if (
    !Array.isArray(value) ||
    value.some((key) => !REQUEST_PERMISSION_KEYS.includes(key))
  ) {
    throw Object.assign(
      new Error("Select valid credential request permissions."),
      { status: 400 },
    );
  }
  return REQUEST_PERMISSION_KEYS.filter((key) => value.includes(key));
}
export function effectiveRequestPermissions(value, role) {
  if (value == null)
    return role === "Super Admin" ? [...REQUEST_PERMISSION_KEYS] : [];
  try {
    return validateRequestPermissions(
      typeof value === "string" ? JSON.parse(value) : value,
    );
  } catch {
    return [];
  }
}
export function canHandleRequest(admin, request) {
  return (
    Array.isArray(admin?.requestPermissions) &&
    admin.requestPermissions.includes(
      `${request.credential_type}:${request.request_kind}`,
    )
  );
}
export function requestPermissionFilter(permissions, alias = "pr") {
  const keys = validateRequestPermissions(permissions);
  return {
    sql: keys.length
      ? `(${keys.map(() => `(${alias}.credential_type=? AND ${alias}.request_kind=?)`).join(" OR ")})`
      : "1=0",
    values: keys.flatMap((key) => key.split(":")),
  };
}
