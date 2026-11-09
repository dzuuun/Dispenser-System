import ExcelJS from "exceljs";
import XLSX from "@e965/xlsx";

const cleanHeader = (value) =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
const isBirthdayHeader = (value) =>
  ["birthday", "birthdate", "dateofbirth"].includes(String(value).replace(/[^a-z0-9]/gi, "").toLowerCase());
const dateText = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : null;

export async function readWorkbookRows(buffer, filename = "") {
  if (/\.xls$/i.test(filename)) {
    const workbook = XLSX.read(buffer, { type: "buffer", cellText: true, cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet?.["!ref"]) return [];
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const cell = (row, column) => sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    const headers = Array.from({ length: range.e.c + 1 }, (_, column) =>
      cleanHeader(cell(range.s.r, column) ? XLSX.utils.format_cell(cell(range.s.r, column)) : ""),
    );
    const rows = [];
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      const values = headers.map((header, column) => {
        const value = cell(row, column);
        if (!value) return "";
        return (isBirthdayHeader(header) && dateText(value.v)) || XLSX.utils.format_cell(value);
      });
      if (values.some((value) => value !== ""))
        rows.push(Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? "")])));
    }
    return rows;
  }
  const workbook = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) await workbook.csv.load(buffer);
  else await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headers = sheet.getRow(1).values.slice(1).map(cleanHeader);
  return (
    sheet
      .getRows(2, Math.max(0, sheet.rowCount - 1))
      ?.filter((row) =>
        row.values
          .slice(1)
          .some(
            (value) => value !== null && value !== undefined && value !== "",
          ),
      )
      .map((row) =>
        Object.fromEntries(
          headers.map((header, index) => [
            header,
            (isBirthdayHeader(header) && dateText(row.getCell(index + 1).value)) || row.getCell(index + 1).text || "",
          ]),
        ),
      ) || []
  );
}

export async function workbookBuffer(rows, sheetName) {
  return multiSheetWorkbookBuffer([{ rows, name: sheetName }]);
}

export async function multiSheetWorkbookBuffer(sheets) {
  const workbook = new ExcelJS.Workbook();
  sheets.forEach(({ rows, name, headers: providedHeaders }, index) => {
    const sheet = workbook.addWorksheet(
      String(name).slice(0, 31) || `Sheet${index + 1}`,
    );
    const headers = providedHeaders || [...new Set(rows.flatMap((row) => Object.keys(row)))];
    sheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.min(60, Math.max(12, header.length + 2)),
    }));
    rows.forEach((row) => sheet.addRow(row));
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function workbookBase64(rows, sheetName) {
  return (await workbookBuffer(rows, sheetName)).toString("base64");
}
