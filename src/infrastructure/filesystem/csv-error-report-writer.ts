import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import type { ValidationError } from '@application/dtos/import-students.dto';
import type { Clock } from '@application/interfaces/clock';
import type { ErrorReport, ErrorReportWriter } from '@application/interfaces/error-report-writer';

const HEADER = ['line_number', 'field', 'value', 'error_message'] as const;
const NEEDS_QUOTES = /[",\r\n]/;
/** Spreadsheet formula prefixes (CSV injection, OWASP). Plain negative numbers are left alone. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const MAX_FILE_NAME_ATTEMPTS = 100;

export const escapeCsvValue = (value: string | number): string => {
  let text = String(value);
  if (typeof value === 'string' && FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`;
  }
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Duck-typed on purpose: `instanceof Error` is unreliable across realms (vm, Jest). */
const isFileExistsError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';

const toCsvLine = (values: readonly (string | number)[]): string =>
  `${values.map(escapeCsvValue).join(',')}\n`;

class CsvErrorReport implements ErrorReport {
  private failure: Error | null = null;

  constructor(
    readonly path: string,
    private readonly stream: WriteStream,
  ) {
    stream.on('error', (error) => {
      this.failure = error;
    });
  }

  async write(error: ValidationError): Promise<void> {
    await this.writeLine(toCsvLine([error.lineNumber, error.field, error.value, error.message]));
  }

  async writeLine(line: string): Promise<void> {
    if (this.failure !== null) {
      throw this.failure;
    }
    if (!this.stream.write(line)) {
      await once(this.stream, 'drain');
    }
  }

  async close(): Promise<void> {
    this.stream.end();
    await finished(this.stream);
  }
}

/** Streams rejected rows to `<dir>/errors-<timestamp>.csv` (columns: line_number, field, value, error_message). */
export class CsvErrorReportWriter implements ErrorReportWriter {
  constructor(
    private readonly directory: string,
    private readonly clock: Clock,
  ) {}

  async open(): Promise<ErrorReport> {
    await mkdir(this.directory, { recursive: true });
    const stamp = this.clock.now().toISOString().replace(/[:.]/g, '-');

    for (let attempt = 0; attempt < MAX_FILE_NAME_ATTEMPTS; attempt += 1) {
      const fileName = attempt === 0 ? `errors-${stamp}.csv` : `errors-${stamp}-${attempt}.csv`;
      const path = join(this.directory, fileName);
      const stream = createWriteStream(path, { flags: 'wx', encoding: 'utf8' });
      try {
        await once(stream, 'open');
      } catch (error: unknown) {
        if (isFileExistsError(error)) {
          continue;
        }
        throw error;
      }
      const report = new CsvErrorReport(path, stream);
      await report.writeLine(toCsvLine(HEADER));
      return report;
    }
    throw new Error(`Could not create a unique error report file in ${this.directory}`);
  }
}
