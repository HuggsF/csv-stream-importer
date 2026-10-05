import type { ValidationError } from '@application/dtos/import-students.dto';

/** An open error report: rows are appended as they are found, never accumulated in memory. */
export interface ErrorReport {
  readonly path: string;
  /** Resolves once the line is accepted by the underlying stream (honours backpressure). */
  write(error: ValidationError): Promise<void>;
  close(): Promise<void>;
}

export interface ErrorReportWriter {
  open(): Promise<ErrorReport>;
}
