import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import csvParser from 'csv-parser';
import type { CsvStreamReader, RawStudentRow } from '@application/interfaces/csv-stream-reader';

export const REQUIRED_COLUMNS = ['name', 'email', 'enrollment_date', 'course_id', 'score'] as const;

export class InvalidCsvHeaderError extends Error {
  constructor(readonly missingColumns: readonly string[]) {
    super(`CSV header is missing required columns: ${missingColumns.join(', ')}`);
    this.name = 'InvalidCsvHeaderError';
  }
}

export type CsvReaderOptions = {
  /** A single row larger than this aborts the import (protects memory from malformed files). */
  readonly maxRowBytes: number;
  /** Bytes read from disk per chunk. */
  readonly highWaterMark?: number;
};

type CsvRecord = Readonly<Record<string, string | undefined>>;

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const normalizeHeader = ({ header }: { header: string }): string =>
  (header.startsWith(BYTE_ORDER_MARK) ? header.slice(1) : header).trim().toLowerCase();

const isBlank = (record: CsvRecord): boolean =>
  Object.values(record).every((value) => value === undefined || value.trim() === '');

/**
 * `fs.createReadStream` → `csv-parser` → async iterator.
 *
 * Nothing is buffered beyond the streams' highWaterMark: when the consumer's `for await`
 * loop is busy (e.g. awaiting a bulk INSERT), the parser's readable buffer fills up, the
 * pipeline stops writing into it and the file stream pauses reading from disk.
 */
export class CsvParserStreamReader implements CsvStreamReader {
  constructor(private readonly options: CsvReaderOptions) {}

  async *read(filePath: string): AsyncIterable<RawStudentRow> {
    const source = createReadStream(filePath, {
      highWaterMark: this.options.highWaterMark ?? 64 * 1024,
    });
    const parser = csvParser({
      mapHeaders: normalizeHeader,
      maxRowBytes: this.options.maxRowBytes,
      strict: false,
    });

    parser.once('headers', (headers: string[]) => {
      const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
      if (missing.length > 0) {
        parser.destroy(new InvalidCsvHeaderError(missing));
      }
    });

    // Errors from either stream destroy the whole pipeline and surface through the iterator.
    const records = pipeline(source, parser, () => undefined);

    let lineNumber = 1;
    try {
      for await (const chunk of records) {
        lineNumber += 1;
        const record = chunk as CsvRecord;
        if (isBlank(record)) {
          continue;
        }
        yield {
          lineNumber,
          name: record.name,
          email: record.email,
          enrollmentDate: record.enrollment_date,
          courseId: record.course_id,
          score: record.score,
        };
      }
    } finally {
      // Consumer stopped early (break/abort/error): release the file descriptor right away.
      source.destroy();
      parser.destroy();
    }
  }
}
