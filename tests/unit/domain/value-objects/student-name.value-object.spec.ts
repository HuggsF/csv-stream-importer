import { InvalidStudentNameError } from '@domain/errors/invalid-student-name.error';
import { StudentName } from '@domain/value-objects/student-name.value-object';

describe('StudentName', () => {
  it.each(['Ana', 'José da Silva', "Shaquille O'Neal", 'Mary-Jane Watson', 'Zoë Ångström', 'Li'])(
    'accepts %s',
    (raw) => {
      const result = StudentName.create(raw);

      expect(result.success && result.data.value).toBe(raw);
    },
  );

  it('trims and collapses inner whitespace', () => {
    const result = StudentName.create('  Maria    Clara \t Souza ');

    expect(result.success && result.data.value).toBe('Maria Clara Souza');
  });

  it.each([
    ['', 'Name is required'],
    ['   ', 'Name is required'],
    ['A', 'Name must be at least 2 characters'],
    ['x'.repeat(101), 'Name must be at most 100 characters'],
    ['John_Doe', 'Name may only contain letters, spaces, hyphens and apostrophes'],
    ['R2D2', 'Name may only contain letters, spaces, hyphens and apostrophes'],
    ['Robert; DROP TABLE', 'Name may only contain letters, spaces, hyphens and apostrophes'],
    ['--', 'Name may only contain letters, spaces, hyphens and apostrophes'],
  ])('rejects %p', (raw, message) => {
    const result = StudentName.create(raw);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidStudentNameError);
      expect(result.error.message).toBe(message);
      expect(result.error.field).toBe('name');
      expect(result.error.code).toBe('INVALID_STUDENT_NAME');
    }
  });

  it('accepts exactly 100 characters', () => {
    expect(StudentName.create('a'.repeat(100)).success).toBe(true);
  });

  it('is immutable and compares by value', () => {
    const first = StudentName.create('Ana Lima');
    const second = StudentName.create(' Ana  Lima ');

    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.data.equals(second.data)).toBe(true);
      expect(first.data.toString()).toBe('Ana Lima');
      expect(Object.isFrozen(first.data)).toBe(true);
    }
  });
});
