import { ApplicationError } from './application.error';

export class InvalidImportOptionsError extends ApplicationError {
  readonly code = 'INVALID_IMPORT_OPTIONS';
}
