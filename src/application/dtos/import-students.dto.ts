export type ImportStudentsInput = {
  readonly filePath: string;
  /** Rows per bulk INSERT. Default: 1000. */
  readonly batchSize?: number;
  /** Aborting stops reading new rows; the rows already validated are still flushed. */
  readonly signal?: AbortSignal;
};

/** One rejected field of one CSV row (a row with three bad fields yields three entries). */
export type ValidationError = {
  readonly lineNumber: number;
  readonly field: string;
  readonly value: string;
  readonly message: string;
};

export type ImportStudentsOutput = {
  readonly totalProcessed: number;
  readonly totalImported: number;
  /** Rows rejected (validation failures + duplicates). */
  readonly totalErrors: number;
  /** First validation errors only (bounded). The complete list is in `errorReportPath`. */
  readonly errors: ValidationError[];
  readonly durationMs: number;
  readonly peakMemoryMB: number;
  readonly rowsPerSecond: number;
  readonly errorReportPath: string | null;
  readonly aborted: boolean;
};
