import { FieldValidationError } from './domain.error';

export class InvalidEmailError extends FieldValidationError {
  readonly code = 'INVALID_EMAIL';

  constructor(value: string, reason: string) {
    super('email', value, reason);
  }
}
