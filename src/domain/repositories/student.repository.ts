import type { Student } from '@domain/entities/student.entity';

export interface StudentRepository {
  /** Persists the batch with a single multi-row INSERT and returns how many rows were inserted. */
  bulkInsert(students: Student[]): Promise<number>;
  findByEmail(email: string): Promise<Student | null>;
  /** Returns the subset of the given (normalised) emails that are already registered. */
  findExistingEmails(emails: readonly string[]): Promise<Set<string>>;
  count(): Promise<number>;
}
