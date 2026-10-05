import { FieldValidationError } from './domain.error';

export class InvalidFilePathError extends FieldValidationError {
  readonly code = 'INVALID_FILE_PATH';

  constructor(value: string, reason: string) {
    super('filePath', value, reason);
  }
}
