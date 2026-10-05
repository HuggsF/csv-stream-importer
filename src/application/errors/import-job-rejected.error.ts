import { ApplicationError } from './application.error';

export type ImportJobRejectionReason = 'queue-full' | 'shutting-down' | 'unexpected';

export class ImportJobRejectedError extends ApplicationError {
  readonly code = 'IMPORT_JOB_REJECTED';

  constructor(
    readonly reason: ImportJobRejectionReason,
    cause?: unknown,
  ) {
    super(ImportJobRejectedError.describe(reason), { cause });
  }

  private static describe(reason: ImportJobRejectionReason): string {
    switch (reason) {
      case 'queue-full':
        return 'Too many imports are queued, try again later';
      case 'shutting-down':
        return 'The server is shutting down and no longer accepts imports';
      case 'unexpected':
        return 'The import job could not be scheduled';
    }
  }
}
