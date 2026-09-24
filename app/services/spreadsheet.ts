export type SpreadsheetRow = Record<string, unknown>;

export async function readFirstWorksheetRows<T extends SpreadsheetRow = SpreadsheetRow>(file: File): Promise<T[]> {
  const { read, utils } = await import("xlsx");
  const workbook = read(await file.arrayBuffer(), { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return utils.sheet_to_json<T>(firstSheet, { defval: "" });
}
