export function displayMiddleName(value) {
  const name = String(value ?? "").trim();
  return name === "-" ? "" : name;
}

export function studentFullName(student) {
  return [
    String(student.first_name ?? student.firstName ?? "").trim(),
    displayMiddleName(student.middle_name ?? student.middleName),
    String(student.last_name ?? student.lastName ?? "").trim(),
  ]
    .filter(Boolean)
    .join(" ");
}
