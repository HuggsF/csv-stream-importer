import { ApplicationError } from './application.error';

export class ImportJobNotFoundError extends ApplicationError {
  readonly code = 'IMPORT_JOB_NOT_FOUND';

  constructor(readonly jobId: string) {
    super(`Import job ${jobId} was not found`);
  }
}
