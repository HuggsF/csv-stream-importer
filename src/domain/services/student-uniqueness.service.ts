import type { Student } from '@domain/entities/student.entity';
import { DuplicateStudentError } from '@domain/errors/duplicate-student.error';

export type DuplicateCandidate<T> = { readonly item: T; readonly error: DuplicateStudentError };

export type UniquenessPartition<T> = {
  readonly unique: T[];
  readonly duplicates: DuplicateCandidate<T>[];
};

/**
 * Enforces the "one student per email" business rule over a batch of candidates.
 * The first occurrence of an email wins; later occurrences and emails that are already
 * registered are rejected with a DuplicateStudentError.
 */
export class StudentUniquenessService {
  partition<T extends { readonly student: Student }>(
    candidates: readonly T[],
    registeredEmails: ReadonlySet<string>,
  ): UniquenessPartition<T> {
    const unique: T[] = [];
    const duplicates: DuplicateCandidate<T>[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const email = candidate.student.email.value;
      if (registeredEmails.has(email)) {
        duplicates.push({ item: candidate, error: new DuplicateStudentError(email, 'existing') });
      } else if (seen.has(email)) {
        duplicates.push({ item: candidate, error: new DuplicateStudentError(email, 'file') });
      } else {
        seen.add(email);
        unique.push(candidate);
      }
    }

    return { unique, duplicates };
  }
}
