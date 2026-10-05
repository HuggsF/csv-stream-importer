import { InvalidEmailError } from '@domain/errors/invalid-email.error';
import { Email } from '@domain/value-objects/email.value-object';

describe('Email', () => {
  it.each([
    'student@school.com',
    'first.last@university.edu.br',
    'user+tag@sub.domain.io',
    "o'brien@example.org",
  ])('accepts a valid address: %s', (raw) => {
    const result = Email.create(raw);

    expect(result.success).toBe(true);
  });

  it('normalises to lowercase and trims whitespace', () => {
    const result = Email.create('  John.DOE@Example.COM ');

    expect(result.success && result.data.value).toBe('john.doe@example.com');
  });

  it.each([
    ['plainaddress', 'Email must be a valid address'],
    ['missing-at.example.com', 'Email must be a valid address'],
    ['user@', 'Email must be a valid address'],
    ['@example.com', 'Email must be a valid address'],
    ['user@example', 'Email must be a valid address'],
    ['user@@example.com', 'Email must be a valid address'],
    ['user name@example.com', 'Email must be a valid address'],
    ['.user@example.com', 'Email must be a valid address'],
    ['user..name@example.com', 'Email must be a valid address'],
    ['user@-example.com', 'Email must be a valid address'],
  ])('rejects %s', (raw, message) => {
    const result = Email.create(raw);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidEmailError);
      expect(result.error.message).toBe(message);
      expect(result.error.field).toBe('email');
      expect(result.error.value).toBe(raw);
      expect(result.error.code).toBe('INVALID_EMAIL');
    }
  });

  it('rejects an empty value as required', () => {
    const result = Email.create('   ');

    expect(!result.success && result.error.message).toBe('Email is required');
  });

  it('rejects addresses longer than 255 characters', () => {
    const raw = `${'a'.repeat(60)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(63)}.com`;

    const result = Email.create(raw);

    expect(raw.length).toBeGreaterThan(Email.MAX_LENGTH);
    expect(!result.success && result.error.message).toBe('Email must be at most 255 characters');
  });

  it('rejects a local part longer than 64 characters', () => {
    const result = Email.create(`${'a'.repeat(65)}@example.com`);

    expect(!result.success && result.error.message).toBe(
      'Email local part must be at most 64 characters',
    );
  });

  it('is immutable and compares by value', () => {
    const first = Email.create('a@b.co');
    const second = Email.create('A@B.CO');

    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      expect(first.data.equals(second.data)).toBe(true);
      expect(first.data.toString()).toBe('a@b.co');
      expect(Object.isFrozen(first.data)).toBe(true);
    }
  });
});
