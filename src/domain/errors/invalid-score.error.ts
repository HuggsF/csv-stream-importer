import { FieldValidationError } from './domain.error';

export class InvalidScoreError extends FieldValidationError {
  readonly code = 'INVALID_SCORE';

  constructor(value: string, reason: string) {
    super('score', value, reason);
  }
}
