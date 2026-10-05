import { DomainError } from './domain.error';
import type { FieldValidationError } from './domain.error';

/** Aggregates every field violation found while creating a Student, so a row is reported once with all of its problems. */
export class InvalidStudentError extends DomainError {
  readonly code = 'INVALID_STUDENT';

  constructor(readonly violations: readonly FieldValidationError[]) {
    super(violations.map((violation) => `${violation.field}: ${violation.message}`).join('; '));
  }
}
