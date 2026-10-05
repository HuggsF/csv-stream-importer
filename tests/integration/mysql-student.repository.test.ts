import { Student } from '@domain/entities/student.entity';
import type { StudentProps } from '@domain/entities/student.entity';
import { migrateLatest, migrateRollback } from '@infrastructure/database/migrator';
import { pingDatabase } from '@infrastructure/database/knex';
import {
  MySqlStudentRepository,
  STUDENTS_TABLE,
} from '@infrastructure/database/mysql-student.repository';
import { CONTAINER_STARTUP_TIMEOUT_MS, startTestDatabase } from '../support/mysql-container';
import type { TestDatabase } from '../support/mysql-container';

const student = (index: number, overrides: Partial<StudentProps> = {}): Student => {
  const result = Student.create({
    id: `0192f1a4-0000-7000-8000-${String(index).padStart(12, '0')}`,
    name: 'José da Silva',
    email: `student.${index}@school.edu`,
    enrollmentDate: '2024-02-29',
    courseId: 'COURSE-101',
    score: '87.25',
    ...overrides,
  });
  if (!result.success) {
    throw result.error;
  }
  return result.data;
};

describe('MySqlStudentRepository (MySQL 8 via testcontainers)', () => {
  let database: TestDatabase;
  let repository: MySqlStudentRepository;

  beforeAll(async () => {
    database = await startTestDatabase();
    repository = new MySqlStudentRepository(database.db);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.stop();
  });

  beforeEach(async () => {
    await database.db(STUDENTS_TABLE).truncate();
  });

  it('creates the students table with the expected columns and indexes', async () => {
    const [columns] = (await database.db.raw('SHOW COLUMNS FROM students')) as [
      { Field: string; Type: string; Null: string; Key: string }[],
    ];
    const [indexes] = (await database.db.raw('SHOW INDEX FROM students')) as [
      { Key_name: string; Column_name: string; Non_unique: number }[],
    ];

    expect(columns.map(({ Field, Type }) => `${Field}:${Type}`)).toEqual([
      'id:varchar(36)',
      'name:varchar(100)',
      'email:varchar(255)',
      'enrollment_date:date',
      'course_id:varchar(36)',
      'score:decimal(5,2)',
      'created_at:timestamp',
    ]);
    expect(
      indexes.map(({ Key_name, Column_name, Non_unique }) => [Key_name, Column_name, Non_unique]),
    ).toEqual(
      expect.arrayContaining([
        ['PRIMARY', 'id', 0],
        ['idx_email', 'email', 0],
        ['idx_course', 'course_id', 1],
      ]),
    );
  });

  it('bulk inserts a batch with a single statement and returns the inserted count', async () => {
    const queries: string[] = [];
    const onQuery = (query: { sql: string }): void => {
      queries.push(query.sql);
    };
    database.db.on('query', onQuery);

    const inserted = await repository.bulkInsert(
      Array.from({ length: 1000 }, (_, index) => student(index)),
    );

    database.db.removeListener('query', onQuery);
    expect(inserted).toBe(1000);
    expect(await repository.count()).toBe(1000);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/^insert ignore into `students`/);
  });

  it('round-trips every field without time-zone or precision drift', async () => {
    await repository.bulkInsert([student(1, { score: '99.99', enrollmentDate: '2024-01-01' })]);

    const found = await repository.findByEmail('STUDENT.1@school.edu');

    expect(found).not.toBeNull();
    expect(found?.name.value).toBe('José da Silva');
    expect(found?.enrollmentDateISO).toBe('2024-01-01');
    expect(found?.score.value).toBe(99.99);
    expect(found?.courseId).toBe('COURSE-101');
  });

  it('returns null for an unknown email', async () => {
    expect(await repository.findByEmail('nobody@school.edu')).toBeNull();
  });

  it('skips rows whose email already exists instead of failing the whole batch', async () => {
    await repository.bulkInsert([student(1)]);

    const inserted = await repository.bulkInsert([
      student(2, { email: 'student.1@school.edu' }),
      student(3),
    ]);

    expect(inserted).toBe(1);
    expect(await repository.count()).toBe(2);
  });

  it('finds which emails of a batch are already registered', async () => {
    await repository.bulkInsert([student(1), student(2)]);

    const existing = await repository.findExistingEmails([
      'student.1@school.edu',
      'student.3@school.edu',
      'student.2@school.edu',
    ]);

    expect(existing).toEqual(new Set(['student.1@school.edu', 'student.2@school.edu']));
    expect(await repository.findExistingEmails([])).toEqual(new Set());
  });

  it('treats an empty batch as a no-op', async () => {
    expect(await repository.bulkInsert([])).toBe(0);
  });

  it('answers the health ping', async () => {
    await expect(pingDatabase(database.db)).resolves.toBeUndefined();
  });

  it('rolls back and re-applies migrations', async () => {
    expect(await migrateRollback(database.db)).toEqual(['20260101000000_create_students_table']);
    expect(await database.db.schema.hasTable(STUDENTS_TABLE)).toBe(false);

    expect(await migrateLatest(database.db)).toEqual(['20260101000000_create_students_table']);
    expect(await migrateLatest(database.db)).toEqual([]);
  });
});
