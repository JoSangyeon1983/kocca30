import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const workDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(workDir, '../..');
const outputDir = path.join(workDir, 'outputs/20261110');
const deliveryDir = path.join(root, '08_산출물/번역 검수');
const outputName = '번역 검수표.xlsx';
const snapshotTime = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const inputs = [
  { file: 'localization.json', sheet: 'UI 문구', title: 'UI 문구 번역표', table: 'LocalizationTable', expected: 183, widths: [330, 480, 620] },
  { file: 'character_name_pool.json', sheet: '이름 풀', title: '이름 풀 번역표', table: 'NamePoolTable', expected: 20, widths: [140, 260, 400] },
];
const workbook = Workbook.create();
const sourceRecords = [];
const weightedLength = value => [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : 0.54), 0);
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(deliveryDir, { recursive: true });

for (const input of inputs) {
  const sourcePath = path.join(root, '90_작업 공간/번역 검수', input.file);
  const bytes = await fs.readFile(sourcePath);
  const source = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const rows = Object.entries(source).map(([key, value]) => [key, value.ko, value.en]);
  assert.equal(rows.length, input.expected);
  assert(rows.every(row => row.every(value => typeof value === 'string' && value.length > 0)));
  const sheet = workbook.worksheets.add(input.sheet);
  const last = rows.length + 6;
  const area = sheet.getRange(`A1:C${last}`);
  area.format.font = { name: 'Arial', size: 11, color: '#202B3D' };
  area.format.verticalAlignment = 'center';
  area.format.rowHeight = 27;
  area.setNumberFormat('@');
  sheet.showGridLines = false;
  sheet.tabColor = input.sheet === 'UI 문구' ? '#223B60' : '#70829B';
  for (const [index, width] of input.widths.entries()) {
    sheet.getRange(`${String.fromCharCode(65 + index)}1:${String.fromCharCode(65 + index)}${last}`).format.columnWidthPx = width;
  }
  sheet.getRange('A1:C1').format.rowHeight = 10;
  sheet.getRange('A2').values = [[input.title]];
  sheet.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: '#223B60' };
  sheet.getRange('A2:C2').format.rowHeight = 31;
  sheet.getRange('A3').values = [[`${rows.length}개 항목`]];
  sheet.getRange('A4').values = [[`출처: ${input.file}, ${snapshotTime} KST 기준`]];
  sheet.getRange('A4').format.font = { name: 'Arial', size: 10, italic: true, color: '#5B687B' };
  sheet.getRange('A5:C5').format.rowHeight = 10;
  sheet.getRange('A5:C5').format.borders = { bottom: { style: 'thin', color: '#CAD3E0' } };
  sheet.getRange(`A6:C${last}`).values = [['키', '한국어 (ko)', '영어 (en)'], ...rows];
  const table = sheet.tables.add(`A6:C${last}`, true, input.table);
  table.style = 'TableStyleMedium2';
  table.showFilterButton = true;
  sheet.getRange('A6:C6').format = {
    fill: '#223B60',
    font: { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    rowHeight: 29,
    borders: { insideVertical: { style: 'thin', color: '#FFFFFF' } },
  };
  sheet.getRange(`A7:C${last}`).format.wrapText = true;
  sheet.getRange(`A7:C${last}`).format.verticalAlignment = 'top';
  let longest = { row: 7, lines: 1 };
  for (const [index, row] of rows.entries()) {
    const lines = Math.max(...row.map((value, column) => Math.ceil(weightedLength(value) * 14.7 / (input.widths[column] - 25))));
    const rowNumber = index + 7;
    sheet.getRange(`A${rowNumber}:C${rowNumber}`).format.rowHeight = Math.max(27, lines * 15 + 11);
    if (lines > longest.lines) longest = { row: rowNumber, lines };
  }
  sheet.freezePanes.freezeRows(6);
  sheet.freezePanes.freezeColumns(1);
  assert.deepEqual(sheet.getRange(`A7:C${last}`).values, rows);
  sourceRecords.push({ ...input, sourcePath, sha256: hash(bytes), rows, last, longest });
}

workbook.recalculate();
console.log((await workbook.inspect({ kind: 'table', range: "'UI 문구'!A6:C9", include: 'values,formulas', tableMaxRows: 4, tableMaxCols: 3, maxChars: 1800 })).ndjson);
console.log((await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 10 }, maxChars: 1200 })).ndjson);
const previews = [
  { sheet: 'UI 문구', range: 'A1:C17', file: 'ui_start.png' },
  { sheet: 'UI 문구', range: `A${Math.max(6, sourceRecords[0].longest.row - 2)}:C${Math.min(sourceRecords[0].last, sourceRecords[0].longest.row + 3)}`, file: 'ui_long.png' },
  { sheet: 'UI 문구', range: 'A180:C189', file: 'ui_end.png' },
  { sheet: '이름 풀', range: 'A1:C26', file: 'name_pool.png' },
];
for (const preview of previews) {
  const blob = await workbook.render({ sheetName: preview.sheet, range: preview.range, scale: 1.25, format: 'png' });
  await fs.writeFile(path.join(outputDir, preview.file), new Uint8Array(await blob.arrayBuffer()));
}
const intermediate = path.join(outputDir, outputName);
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(intermediate);
const restored = await SpreadsheetFile.importXlsx(await FileBlob.load(intermediate));
for (const record of sourceRecords) {
  assert.deepEqual(restored.worksheets.getItem(record.sheet).getRange(`A7:C${record.last}`).values, record.rows);
  assert.equal(hash(await fs.readFile(record.sourcePath)), record.sha256, `${record.file} changed during export`);
}
const delivery = path.join(deliveryDir, outputName);
await fs.copyFile(intermediate, delivery);
assert.equal(hash(await fs.readFile(delivery)), hash(await fs.readFile(intermediate)));
const manifest = {
  snapshotTime: `${snapshotTime} KST`,
  delivery,
  sha256: hash(await fs.readFile(delivery)),
  bytes: (await fs.stat(delivery)).size,
  verifiedDataCells: sourceRecords.reduce((sum, input) => sum + input.rows.length * 3, 0),
  sources: sourceRecords.map(({ file, sheet, sha256, expected, last }) => ({ file, sheet, sha256, rows: expected, dataRange: `A7:C${last}` })),
  previews,
};
await fs.writeFile(path.join(outputDir, 'verification.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
