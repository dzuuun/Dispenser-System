export const ACADEMIC_LEVELS = new Set(["COLLEGE", "GRADUATE_SCHOOL", "OTHER"]);

export function normalizeAcademicLevel(value) {
  const level = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return ACADEMIC_LEVELS.has(level) ? level : null;
}

// Used only when classifying new/legacy courses without an explicit level.
// Unclear programs stay Other until an administrator reviews them.
export function inferAcademicLevel(code, name) {
  const courseCode = String(code || "")
    .trim()
    .toUpperCase();
  const courseName = String(name || "")
    .trim()
    .toUpperCase();
  if (
    /\b(MASTER|MASTERAL|DOCTOR|DOCTORAL|GRADUATE SCHOOL)\b/.test(courseName) ||
    /^(MAED|PH\.?D)(?:\b|[-.])/.test(courseCode)
  )
    return "GRADUATE_SCHOOL";
  if (
    /^(BACHELOR|ASSOCIATE)\b/.test(courseName) ||
    /^(BS|BEED|BLIS|BPED)/.test(courseCode) ||
    /^(AB|BA|BAT|BPA|BPE)(?:-|$)/.test(courseCode)
  )
    return "COLLEGE";
  return "OTHER";
}

export const isSatpEligible = (level) => level === "COLLEGE";
