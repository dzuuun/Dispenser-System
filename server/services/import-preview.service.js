const PAGE_SIZE = 250;

// Preview values are plain text. Never pass password values to this helper.
export function importChange(field, before, after) {
  const previous = String(before ?? "");
  const next = String(after ?? "");
  return previous === next ? null : { field, before: previous, after: next };
}

// Each category is paged independently; inspecting a page never limits import.
export function importPreview(groups, query = {}) {
  const category = query.category ?? "";
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (
    typeof category !== "string" ||
    (category && !Object.hasOwn(groups, category)) ||
    (query.offset !== undefined &&
      (typeof query.offset !== "string" || !/^\d+$/.test(query.offset))) ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw Object.assign(new Error("Invalid import preview page."), {
      status: 400,
    });
  }
  const page = (records, start = 0) => ({
    records: records.slice(start, start + PAGE_SIZE),
    recordTotal: records.length,
    nextOffset: Math.min(start + PAGE_SIZE, records.length),
    hasMore: start + PAGE_SIZE < records.length,
  });
  return category
    ? { category, page: page(groups[category], offset) }
    : {
        groups: Object.fromEntries(
          Object.entries(groups).map(([key, rows]) => [key, page(rows)]),
        ),
      };
}

export const importErrorPreview = (errors) =>
  errors.map((error) => ({
    row: error.row,
    label: error.message,
    message: "This row will be skipped.",
  }));
