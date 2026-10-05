import { Student } from '@domain/entities/student.entity';
import { DuplicateStudentError } from '@domain/errors/duplicate-student.error';
import { StudentUniquenessService } from '@domain/services/student-uniqueness.service';

type Candidate = { readonly student: Student; readonly lineNumber: number };

const candidate = (email: string, lineNumber: number): Candidate => {
  const result = Student.create({
    id: `id-${lineNumber}`,
    name: 'Ana Souza',
    email,
    enrollmentDate: '2024-01-01',
    courseId: 'COURSE-1',
    score: 50,
  });
  if (!result.success) {
    throw result.error;
  }
  return { student: result.data, lineNumber };
};

describe('StudentUniquenessService', () => {
  const service = new StudentUniquenessService();

  it('keeps every candidate when all emails are new and distinct', () => {
    const candidates = [candidate('a@x.io', 2), candidate('b@x.io', 3)];

    const { unique, duplicates } = service.partition(candidates, new Set());

    expect(unique).toEqual(candidates);
    expect(duplicates).toHaveLength(0);
  });

  it('rejects emails already registered', () => {
    const { unique, duplicates } = service.partition(
      [candidate('a@x.io', 2), candidate('b@x.io', 3)],
      new Set(['b@x.io']),
    );

    expect(unique.map((item) => item.lineNumber)).toEqual([2]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.item.lineNumber).toBe(3);
    expect(duplicates[0]?.error).toBeInstanceOf(DuplicateStudentError);
    expect(duplicates[0]?.error.source).toBe('existing');
    expect(duplicates[0]?.error.message).toBe('A student with this email is already registered');
  });

  it('keeps the first occurrence of an email repeated in the batch', () => {
    const { unique, duplicates } = service.partition(
      [candidate('a@x.io', 2), candidate('A@X.io', 3), candidate('a@x.io', 4)],
      new Set(),
    );

    expect(unique.map((item) => item.lineNumber)).toEqual([2]);
    expect(duplicates.map(({ item }) => item.lineNumber)).toEqual([3, 4]);
    expect(duplicates.every(({ error }) => error.source === 'file')).toBe(true);
    expect(duplicates[0]?.error.message).toBe('Email appears more than once in the file');
    expect(duplicates[0]?.error.field).toBe('email');
    expect(duplicates[0]?.error.value).toBe('a@x.io');
    expect(duplicates[0]?.error.code).toBe('DUPLICATE_STUDENT');
  });
});
