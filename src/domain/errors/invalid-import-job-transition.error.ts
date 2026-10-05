import { DomainError } from './domain.error';

export class InvalidImportJobTransitionError extends DomainError {
  readonly code = 'INVALID_IMPORT_JOB_TRANSITION';

  constructor(
    readonly jobId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Import job ${jobId} cannot move from "${from}" to "${to}"`);
  }
}
