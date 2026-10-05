import { FieldValidationError } from './domain.error';

export type DuplicateStudentSource = 'existing' | 'file';

export class DuplicateStudentError extends FieldValidationError {
  readonly code = 'DUPLICATE_STUDENT';

  constructor(
    email: string,
    readonly source: DuplicateStudentSource,
  ) {
    super(
      'email',
      email,
      source === 'existing'
        ? 'A student with this email is already registered'
        : 'Email appears more than once in the file',
    );
  }
}
