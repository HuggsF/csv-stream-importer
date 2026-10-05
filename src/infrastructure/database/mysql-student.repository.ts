import type { Knex } from 'knex';
import { Student } from '@domain/entities/student.entity';
import type { StudentRepository } from '@domain/repositories/student.repository';

export const STUDENTS_TABLE = 'students';

export type StudentRow = {
  id: string;
  name: string;
  email: string;
  enrollment_date: string;
  course_id: string;
  score: number | string;
  created_at?: Date | string | null;
};

const toRow = (student: Student): Omit<StudentRow, 'created_at'> => ({
  id: student.id,
  name: student.name.value,
  email: student.email.value,
  enrollment_date: student.enrollmentDateISO,
  course_id: student.courseId,
  score: student.score.value,
});

const toEntity = (row: StudentRow): Student => {
  const result = Student.create({
    id: row.id,
    name: row.name,
    email: row.email,
    enrollmentDate: row.enrollment_date,
    courseId: row.course_id,
    score: Number(row.score),
  });
  if (!result.success) {
    throw new Error(`Corrupted student row ${row.id}: ${result.error.message}`);
  }
  return result.data;
};

const affectedRowsOf = (result: unknown): number => {
  const header: unknown = Array.isArray(result) ? result[0] : result;
  if (typeof header === 'object' && header !== null && 'affectedRows' in header) {
    const { affectedRows } = header;
    if (typeof affectedRows === 'number') {
      return affectedRows;
    }
  }
  throw new Error('Unexpected MySQL response: affectedRows is missing');
};

export class MySqlStudentRepository implements StudentRepository {
  constructor(private readonly db: Knex) {}

  /**
   * One multi-row statement per batch: `INSERT IGNORE INTO students (...) VALUES (...), (...)`.
   * Duplicates are filtered by the use case beforehand; IGNORE is only a safety net for
   * concurrent imports, and `affectedRows` tells exactly how many rows were inserted.
   * Every value was validated by the Domain, so IGNORE cannot hide truncation errors.
   */
  async bulkInsert(students: Student[]): Promise<number> {
    if (students.length === 0) {
      return 0;
    }
    const { sql, bindings } = this.db(STUDENTS_TABLE)
      .insert(students.map(toRow))
      .onConflict('email')
      .ignore()
      .toSQL()
      .toNative();
    const result: unknown = await this.db.raw(sql, bindings);
    return affectedRowsOf(result);
  }

  async findByEmail(email: string): Promise<Student | null> {
    const row = await this.db<StudentRow>(STUDENTS_TABLE)
      .where({ email: email.trim().toLowerCase() })
      .first();
    return row === undefined ? null : toEntity(row);
  }

  async findExistingEmails(emails: readonly string[]): Promise<Set<string>> {
    if (emails.length === 0) {
      return new Set();
    }
    const rows = await this.db<StudentRow>(STUDENTS_TABLE)
      .select('email')
      .whereIn('email', [...emails]);
    return new Set(rows.map((row) => row.email));
  }

  async count(): Promise<number> {
    const result = await this.db(STUDENTS_TABLE).count({ total: '*' }).first();
    return Number(result?.total ?? 0);
  }
}
