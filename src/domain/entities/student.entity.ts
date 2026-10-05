import type { FieldValidationError } from '@domain/errors/domain.error';
import { InvalidCourseIdError } from '@domain/errors/invalid-course-id.error';
import { InvalidEnrollmentDateError } from '@domain/errors/invalid-enrollment-date.error';
import { InvalidStudentIdError } from '@domain/errors/invalid-student-id.error';
import { InvalidStudentError } from '@domain/errors/invalid-student.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { Email } from '@domain/value-objects/email.value-object';
import { Score } from '@domain/value-objects/score.value-object';
import { StudentName } from '@domain/value-objects/student-name.value-object';

export type StudentProps = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** `YYYY-MM-DD` (as found in the CSV) or a Date. */
  readonly enrollmentDate: string | Date;
  readonly courseId: string;
  readonly score: number | string;
};

const ID_MAX_LENGTH = 36;
const COURSE_ID_MAX_LENGTH = 36;
const COURSE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_ENROLLMENT_YEAR = 1900;
const MAX_ENROLLMENT_YEAR = 2100;

export class Student {
  private constructor(
    readonly id: string,
    readonly name: StudentName,
    readonly email: Email,
    readonly enrollmentDate: Date,
    readonly courseId: string,
    readonly score: Score,
  ) {
    Object.freeze(this);
  }

  /**
   * Validates every field and returns either a Student or ALL violations found,
   * so an invalid CSV row can be reported with every problem at once.
   */
  static create(props: StudentProps): Result<Student, InvalidStudentError> {
    const violations: FieldValidationError[] = [];
    const collect = <T>(result: Result<T, FieldValidationError>): T | null => {
      if (result.success) {
        return result.data;
      }
      violations.push(result.error);
      return null;
    };

    const id = collect(Student.validateId(props.id));
    const name = collect(StudentName.create(props.name));
    const email = collect(Email.create(props.email));
    const enrollmentDate = collect(Student.validateEnrollmentDate(props.enrollmentDate));
    const courseId = collect(Student.validateCourseId(props.courseId));
    const score = collect(Score.create(props.score));

    if (
      id === null ||
      name === null ||
      email === null ||
      enrollmentDate === null ||
      courseId === null ||
      score === null
    ) {
      return fail(new InvalidStudentError(violations));
    }

    return ok(new Student(id, name, email, enrollmentDate, courseId, score));
  }

  /** Enrollment date as a calendar date (`YYYY-MM-DD`), independent of time zones. */
  get enrollmentDateISO(): string {
    return this.enrollmentDate.toISOString().slice(0, 10);
  }

  equals(other: Student): boolean {
    return this.id === other.id;
  }

  private static validateId(raw: string): Result<string, InvalidStudentIdError> {
    const id = raw.trim();
    if (id.length === 0) {
      return fail(new InvalidStudentIdError(raw, 'Id is required'));
    }
    if (id.length > ID_MAX_LENGTH) {
      return fail(new InvalidStudentIdError(raw, `Id must be at most ${ID_MAX_LENGTH} characters`));
    }
    return ok(id);
  }

  private static validateCourseId(raw: string): Result<string, InvalidCourseIdError> {
    const courseId = raw.trim();
    if (courseId.length === 0) {
      return fail(new InvalidCourseIdError(raw, 'Course id is required'));
    }
    if (courseId.length > COURSE_ID_MAX_LENGTH) {
      return fail(
        new InvalidCourseIdError(
          raw,
          `Course id must be at most ${COURSE_ID_MAX_LENGTH} characters`,
        ),
      );
    }
    if (!COURSE_ID_PATTERN.test(courseId)) {
      return fail(
        new InvalidCourseIdError(
          raw,
          'Course id may only contain letters, digits, hyphens and underscores',
        ),
      );
    }
    return ok(courseId);
  }

  /** Dates are normalised to UTC midnight so the calendar day never shifts with the server time zone. */
  private static validateEnrollmentDate(
    raw: string | Date,
  ): Result<Date, InvalidEnrollmentDateError> {
    if (raw instanceof Date) {
      if (Number.isNaN(raw.getTime())) {
        return fail(new InvalidEnrollmentDateError('Invalid Date', 'Enrollment date is invalid'));
      }
      return Student.buildDate(
        raw.getUTCFullYear(),
        raw.getUTCMonth() + 1,
        raw.getUTCDate(),
        raw.toISOString(),
      );
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return fail(new InvalidEnrollmentDateError(raw, 'Enrollment date is required'));
    }
    const match = ISO_DATE_PATTERN.exec(trimmed);
    if (match === null) {
      return fail(
        new InvalidEnrollmentDateError(raw, 'Enrollment date must use the YYYY-MM-DD format'),
      );
    }
    const [, year, month, day] = match;
    return Student.buildDate(Number(year), Number(month), Number(day), raw);
  }

  private static buildDate(
    year: number,
    month: number,
    day: number,
    raw: string,
  ): Result<Date, InvalidEnrollmentDateError> {
    if (year < MIN_ENROLLMENT_YEAR || year > MAX_ENROLLMENT_YEAR) {
      return fail(
        new InvalidEnrollmentDateError(
          raw,
          `Enrollment year must be between ${MIN_ENROLLMENT_YEAR} and ${MAX_ENROLLMENT_YEAR}`,
        ),
      );
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    const isRealCalendarDay =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
    if (!isRealCalendarDay) {
      return fail(
        new InvalidEnrollmentDateError(raw, 'Enrollment date is not a valid calendar date'),
      );
    }
    return ok(date);
  }
}
