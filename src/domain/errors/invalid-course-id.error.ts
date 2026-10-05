import { FieldValidationError } from './domain.error';

export class InvalidCourseIdError extends FieldValidationError {
  readonly code = 'INVALID_COURSE_ID';

  constructor(value: string, reason: string) {
    super('course_id', value, reason);
  }
}
