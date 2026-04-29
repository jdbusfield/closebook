import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const path = "C:\\Users\\JDBusfield\\Downloads\\Combined Working Trial Balance - 2025.xlsx";

const buffer = readFileSync(path);
const wb = XLSX.read(buffer, { type: "buffer" });
console.log("=== SHEETS ===");
for (const name of wb.SheetNames) {
  console.log(name);
}

for (const sheetName of wb.SheetNames) {
  console.log("\n\n===== SHEET:", sheetName, "=====");
  const sheet = wb.Sheets[sheetName];
  const range = sheet["!ref"];
  console.log("Range:", range);

  // Dump first ~80 rows as array of arrays
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const max = Math.min(aoa.length, 200);
  for (let i = 0; i < max; i++) {
    const row = aoa[i] || [];
    // Trim trailing nulls for readability
    let last = row.length - 1;
    while (last >= 0 && (row[last] === null || row[last] === "")) last--;
    const trimmed = row.slice(0, last + 1);
    if (trimmed.length === 0) continue;
    console.log(`r${i + 1}:`, JSON.stringify(trimmed));
  }
  if (aoa.length > max) console.log(`... (${aoa.length - max} more rows)`);
}
