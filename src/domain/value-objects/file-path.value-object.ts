import { InvalidFilePathError } from '@domain/errors/invalid-file-path.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/**
 * Location of a CSV file to import.
 * Only the format is validated here; whether the file is actually readable is an
 * I/O concern checked by the Application layer through the FileStorage port.
 */
export class FilePath {
  static readonly EXTENSION = '.csv';

  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static create(raw: string): Result<FilePath, InvalidFilePathError> {
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      return fail(new InvalidFilePathError(raw, 'File path is required'));
    }
    if (trimmed.includes('\0')) {
      return fail(new InvalidFilePathError(raw, 'File path contains invalid characters'));
    }
    if (!trimmed.toLowerCase().endsWith(FilePath.EXTENSION)) {
      return fail(
        new InvalidFilePathError(raw, `File must have a ${FilePath.EXTENSION} extension`),
      );
    }

    return ok(new FilePath(trimmed));
  }

  toString(): string {
    return this.value;
  }
}
