// Minimal RFC-4180-style CSV parser: quoted fields, escaped quotes (""), CRLF/LF, optional ; or tab delimiter.

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): CsvTable {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((f) => f.trim() !== ''));
  const [headers = [], ...rows] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows: rows.map((r) => r.map((f) => f.trim())) };
}
