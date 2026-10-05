import { Student } from '@domain/entities/student.entity';
import type { StudentProps } from '@domain/entities/student.entity';
import { InvalidCourseIdError } from '@domain/errors/invalid-course-id.error';
import { InvalidEmailError } from '@domain/errors/invalid-email.error';
import { InvalidEnrollmentDateError } from '@domain/errors/invalid-enrollment-date.error';
import { InvalidScoreError } from '@domain/errors/invalid-score.error';
import { InvalidStudentIdError } from '@domain/errors/invalid-student-id.error';
import { InvalidStudentNameError } from '@domain/errors/invalid-student-name.error';
import { InvalidStudentError } from '@domain/errors/invalid-student.error';

const validProps = (overrides: Partial<StudentProps> = {}): StudentProps => ({
  id: '0190a6f2-7f3b-7c1e-9a51-1f2d3c4b5a69',
  name: 'Ana Souza',
  email: 'Ana.Souza@Example.com',
  enrollmentDate: '2024-03-15',
  courseId: 'c0a80121-7ac0-4e1c-9b8e-3f2a1b4c5d6e',
  score: '87.25',
  ...overrides,
});

const violationsOf = (props: StudentProps): InvalidStudentError => {
  const result = Student.create(props);
  if (result.success) {
    throw new Error('expected Student.create to fail');
  }
  return result.error;
};

describe('Student', () => {
  describe('create', () => {
    it('creates a student with normalised value objects', () => {
      const result = Student.create(validProps());

      expect(result.success).toBe(true);
      if (result.success) {
        const student = result.data;
        expect(student.id).toBe('0190a6f2-7f3b-7c1e-9a51-1f2d3c4b5a69');
        expect(student.name.value).toBe('Ana Souza');
        expect(student.email.value).toBe('ana.souza@example.com');
        expect(student.enrollmentDate.toISOString()).toBe('2024-03-15T00:00:00.000Z');
        expect(student.enrollmentDateISO).toBe('2024-03-15');
        expect(student.courseId).toBe('c0a80121-7ac0-4e1c-9b8e-3f2a1b4c5d6e');
        expect(student.score.value).toBe(87.25);
        expect(Object.isFrozen(student)).toBe(true);
      }
    });

    it('accepts a Date instance and normalises it to UTC midnight', () => {
      const result = Student.create(
        validProps({ enrollmentDate: new Date('2023-11-05T18:45:00.000Z'), score: 90 }),
      );

      expect(result.success && result.data.enrollmentDateISO).toBe('2023-11-05');
    });

    it('collects every violation of an invalid row at once', () => {
      const error = violationsOf({
        id: '',
        name: 'X',
        email: 'not-an-email',
        enrollmentDate: '15/03/2024',
        courseId: '',
        score: '150',
      });

      expect(error).toBeInstanceOf(InvalidStudentError);
      expect(error.code).toBe('INVALID_STUDENT');
      expect(error.violations.map((violation) => violation.constructor)).toEqual([
        InvalidStudentIdError,
        InvalidStudentNameError,
        InvalidEmailError,
        InvalidEnrollmentDateError,
        InvalidCourseIdError,
        InvalidScoreError,
      ]);
      expect(error.violations.map((violation) => violation.field)).toEqual([
        'id',
        'name',
        'email',
        'enrollment_date',
        'course_id',
        'score',
      ]);
      expect(error.message).toContain('email: Email must be a valid address');
    });

    it('reports only the invalid field when the rest of the row is valid', () => {
      const error = violationsOf(validProps({ score: '-1' }));

      expect(error.violations).toHaveLength(1);
      expect(error.violations[0]).toBeInstanceOf(InvalidScoreError);
    });
  });

  describe('id validation', () => {
    it('rejects ids longer than 36 characters', () => {
      const error = violationsOf(validProps({ id: 'x'.repeat(37) }));

      expect(error.violations[0]?.message).toBe('Id must be at most 36 characters');
    });
  });

  describe('enrollment date validation', () => {
    it.each([
      ['', 'Enrollment date is required'],
      ['2024/03/15', 'Enrollment date must use the YYYY-MM-DD format'],
      ['not-a-date', 'Enrollment date must use the YYYY-MM-DD format'],
      ['2024-02-30', 'Enrollment date is not a valid calendar date'],
      ['2023-13-01', 'Enrollment date is not a valid calendar date'],
      ['1899-12-31', 'Enrollment year must be between 1900 and 2100'],
      ['2101-01-01', 'Enrollment year must be between 1900 and 2100'],
    ])('rejects %p', (enrollmentDate, message) => {
      const error = violationsOf(validProps({ enrollmentDate }));

      expect(error.violations[0]).toBeInstanceOf(InvalidEnrollmentDateError);
      expect(error.violations[0]?.message).toBe(message);
    });

    it('accepts a leap day', () => {
      expect(Student.create(validProps({ enrollmentDate: '2024-02-29' })).success).toBe(true);
    });

    it('rejects an invalid Date instance', () => {
      const error = violationsOf(validProps({ enrollmentDate: new Date('garbage') }));

      expect(error.violations[0]?.message).toBe('Enrollment date is invalid');
    });
  });

  describe('course id validation', () => {
    it.each([
      ['x'.repeat(37), 'Course id must be at most 36 characters'],
      ['course 101', 'Course id may only contain letters, digits, hyphens and underscores'],
      ['course;drop', 'Course id may only contain letters, digits, hyphens and underscores'],
    ])('rejects %p', (courseId, message) => {
      const error = violationsOf(validProps({ courseId }));

      expect(error.violations[0]).toBeInstanceOf(InvalidCourseIdError);
      expect(error.violations[0]?.message).toBe(message);
    });

    it('accepts human readable course codes', () => {
      expect(Student.create(validProps({ courseId: 'MATH_101-A' })).success).toBe(true);
    });
  });

  it('compares entities by identity', () => {
    const first = Student.create(validProps());
    const sameId = Student.create(validProps({ name: 'Other Name' }));
    const otherId = Student.create(validProps({ id: 'another-id' }));

    expect(first.success && sameId.success && otherId.success).toBe(true);
    if (first.success && sameId.success && otherId.success) {
      expect(first.data.equals(sameId.data)).toBe(true);
      expect(first.data.equals(otherId.data)).toBe(false);
    }
  });
});
