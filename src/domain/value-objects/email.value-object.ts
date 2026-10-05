import { InvalidEmailError } from '@domain/errors/invalid-email.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/** HTML5-style address check: a pragmatic subset of RFC 5322 that rejects what a mail server would. */
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export class Email {
  static readonly MAX_LENGTH = 255;
  static readonly MAX_LOCAL_PART_LENGTH = 64;

  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  /** Trims and lowercases the address before validating it. */
  static create(raw: string): Result<Email, InvalidEmailError> {
    const normalized = raw.trim().toLowerCase();

    if (normalized.length === 0) {
      return fail(new InvalidEmailError(raw, 'Email is required'));
    }
    if (normalized.length > Email.MAX_LENGTH) {
      return fail(
        new InvalidEmailError(raw, `Email must be at most ${Email.MAX_LENGTH} characters`),
      );
    }
    if (!EMAIL_PATTERN.test(normalized)) {
      return fail(new InvalidEmailError(raw, 'Email must be a valid address'));
    }
    const localPart = normalized.slice(0, normalized.lastIndexOf('@'));
    if (localPart.length > Email.MAX_LOCAL_PART_LENGTH) {
      return fail(
        new InvalidEmailError(
          raw,
          `Email local part must be at most ${Email.MAX_LOCAL_PART_LENGTH} characters`,
        ),
      );
    }

    return ok(new Email(normalized));
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
