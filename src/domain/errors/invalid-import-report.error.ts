import { DomainError } from './domain.error';

export class InvalidImportReportError extends DomainError {
  readonly code = 'INVALID_IMPORT_REPORT';

  constructor(reason: string) {
    super(`Import report is inconsistent: ${reason}`);
  }
}
