/**
 * In-house RFC 4180 CSV parsing and writing for Collections (WAVES_10-12.md
 * D59, T55, T56). Pure and dependency-free.
 *
 * Parsing: an optional UTF-8 BOM is dropped; fields are separated by commas
 * and records by CRLF, LF, or CR; a quoted field may contain commas, line
 * breaks, and doubled quotes; a quote inside an unquoted field is literal.
 * An unterminated quote or text after a closing quote is an error. Records
 * whose every field is empty are skipped. Row and column caps stop the parse
 * as soon as they are exceeded.
 *
 * Writing: UTF-8 with a BOM, CRLF line ends, and quoting when a field holds a
 * comma, quote, CR, LF, or leading/trailing space. Text that a spreadsheet
 * would run as a formula is neutralized with a leading apostrophe.
 */
export class CsvError extends Error {
  constructor(message: string, readonly line: number) {
    super(message);
  }
}

export type CsvLimits = { maxRecords: number; maxColumns: number };

export function parseCsv(input: string, limits: CsvLimits): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let line = 1;
  let recordLine = 1;
  let index = 0;
  const length = text.length;

  const endField = () => {
    record.push(field);
    field = "";
    if (record.length > limits.maxColumns) throw new CsvError(`Use at most ${limits.maxColumns} columns`, recordLine);
  };
  const endRecord = () => {
    endField();
    if (record.some((value) => value !== "")) {
      records.push(record);
      if (records.length > limits.maxRecords) throw new CsvError(`Use at most ${limits.maxRecords - 1} rows`, recordLine);
    }
    record = [];
    recordLine = line;
  };

  while (index < length) {
    const char = text[index]!;
    if (char === "\"" && field === "") {
      // A quoted field: read to the closing quote, un-doubling "" on the way.
      const start = line;
      index += 1;
      let closed = false;
      let chunkStart = index;
      while (index < length) {
        const next = text.indexOf("\"", index);
        if (next < 0) break;
        // Count line breaks inside the quoted chunk for error messages.
        for (let at = index; at < next; at += 1) if (text[at] === "\n" || (text[at] === "\r" && text[at + 1] !== "\n")) line += 1;
        if (text[next + 1] === "\"") {
          field += text.slice(chunkStart, next + 1);
          index = next + 2;
          chunkStart = index;
          continue;
        }
        field += text.slice(chunkStart, next);
        index = next + 1;
        closed = true;
        break;
      }
      if (!closed) throw new CsvError("A quoted field is not closed", start);
      const after = text[index];
      if (after !== undefined && after !== "," && after !== "\n" && after !== "\r") throw new CsvError("Unexpected text after a closing quote", line);
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
    } else if (char === "\r" || char === "\n") {
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1;
      line += 1;
      endRecord();
    } else {
      // Plain text up to the next separator.
      let end = index;
      while (end < length) {
        const code = text.charCodeAt(end);
        if (code === 44 || code === 10 || code === 13) break;
        end += 1;
      }
      field += text.slice(index, end);
      index = end;
    }
  }
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

/** Text a spreadsheet would treat as a formula or control input starts with one of these (T55). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: string) {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Reverses neutralizeFormula on import, so an exported file imports back unchanged. */
export function restoreNeutralized(value: string) {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

function quote(value: string) {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

/** Serializes records as UTF-8 CSV with a BOM and CRLF line ends. Cells must already be neutralized. */
export function writeCsv(records: string[][]) {
  return `﻿${records.map((record) => record.map(quote).join(",")).join("\r\n")}\r\n`;
}
