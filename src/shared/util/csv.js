/** RFC 4180-ish CSV serialisation (Excel-friendly, CRLF, BOM optional). */

export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** @param {any[][]} rows */
export function toCsv(rows, { bom = true } = {}) {
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return (bom ? '﻿' : '') + body;
}

export default { toCsv, csvCell };
