import type { ImportJobStatusOutput } from '@application/dtos/import-job.dto';
import type { ImportStudentsOutput } from '@application/dtos/import-students.dto';
import type { ImportJob, ImportReport } from '@domain/entities/import-job.entity';

export const toImportReport = (output: ImportStudentsOutput): ImportReport => ({
  ...output,
  errors: [...output.errors],
});

export const toImportStudentsOutput = (report: ImportReport): ImportStudentsOutput => ({
  ...report,
  errors: report.errors.map((error) => ({ ...error })),
});

export const toImportJobStatusOutput = (job: ImportJob): ImportJobStatusOutput => ({
  jobId: job.id,
  fileName: job.fileName,
  status: job.status,
  createdAt: job.createdAt.toISOString(),
  startedAt: job.startedAt?.toISOString() ?? null,
  finishedAt: job.finishedAt?.toISOString() ?? null,
  result: job.report === null ? null : toImportStudentsOutput(job.report),
  error: job.failureReason,
});
