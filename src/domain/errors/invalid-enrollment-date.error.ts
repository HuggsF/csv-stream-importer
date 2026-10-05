import { FieldValidationError } from './domain.error';

export class InvalidEnrollmentDateError extends FieldValidationError {
  readonly code = 'INVALID_ENROLLMENT_DATE';

  constructor(value: string, reason: string) {
    super('enrollment_date', value, reason);
  }
}
