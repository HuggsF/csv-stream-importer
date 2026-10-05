import type { ImportStudentsOutput } from './import-students.dto';

export type StartImportJobInput = {
  /** Where the uploaded CSV was stored. */
  readonly filePath: string;
  /** File name as sent by the client (informational only). */
  readonly originalFileName: string;
  readonly batchSize?: number;
};

export type StartImportJobOutput = {
  readonly jobId: string;
};

export type ProcessImportJobInput = {
  readonly jobId: string;
  readonly filePath: string;
  readonly batchSize: number;
  readonly signal?: AbortSignal;
};

export type GetImportJobStatusInput = {
  readonly jobId: string;
};

export type ImportJobStatusOutput = {
  readonly jobId: string;
  readonly fileName: string;
  readonly status: 'pending' | 'processing' | 'completed' | 'failed';
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly result: ImportStudentsOutput | null;
  readonly error: string | null;
};
