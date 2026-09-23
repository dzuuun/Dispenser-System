import ExcelJS from "exceljs";

const cleanHeader = (value) =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();

export async function readWorkbookRows(buffer, filename = "") {
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
            row.getCell(index + 1).text ?? "",
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
  sheets.forEach(({ rows, name }, index) => {
    const sheet = workbook.addWorksheet(
      String(name).slice(0, 31) || `Sheet${index + 1}`,
    );
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
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
