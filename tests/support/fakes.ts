import type { ValidationError } from '@application/dtos/import-students.dto';
import type { Clock } from '@application/interfaces/clock';
import type { CsvStreamReader, RawStudentRow } from '@application/interfaces/csv-stream-reader';
import type { ErrorReport, ErrorReportWriter } from '@application/interfaces/error-report-writer';
import type { FileStorage } from '@application/interfaces/file-storage';
import type { IdGenerator } from '@application/interfaces/id-generator';
import type { LogContext, Logger } from '@application/interfaces/logger';
import type { PerformanceMonitor } from '@application/interfaces/performance-monitor';
import type { ImportJob } from '@domain/entities/import-job.entity';
import type { Student } from '@domain/entities/student.entity';
import type { ImportJobRepository } from '@domain/repositories/import-job.repository';
import type { StudentRepository } from '@domain/repositories/student.repository';

export class InMemoryStudentRepository implements StudentRepository {
  readonly students = new Map<string, Student>();
  readonly insertedBatches: number[] = [];
  existingEmailLookups = 0;

  async bulkInsert(students: Student[]): Promise<number> {
    await Promise.resolve();
    this.insertedBatches.push(students.length);
    let inserted = 0;
    for (const student of students) {
      if (!this.students.has(student.email.value)) {
        this.students.set(student.email.value, student);
        inserted += 1;
      }
    }
    return inserted;
  }

  async findByEmail(email: string): Promise<Student | null> {
    await Promise.resolve();
    return this.students.get(email) ?? null;
  }

  async findExistingEmails(emails: readonly string[]): Promise<Set<string>> {
    await Promise.resolve();
    this.existingEmailLookups += 1;
    return new Set(emails.filter((email) => this.students.has(email)));
  }

  async count(): Promise<number> {
    await Promise.resolve();
    return this.students.size;
  }
}

export class ArrayCsvReader implements CsvStreamReader {
  pulled = 0;

  constructor(
    private readonly rows: readonly Omit<RawStudentRow, 'lineNumber'>[],
    private readonly failAfter: number | null = null,
  ) {}

  async *read(_filePath: string): AsyncIterable<RawStudentRow> {
    for (const [index, row] of this.rows.entries()) {
      if (this.failAfter !== null && index === this.failAfter) {
        throw new Error('Unexpected end of CSV stream');
      }
      this.pulled += 1;
      await Promise.resolve();
      yield { ...row, lineNumber: index + 2 };
    }
  }
}

export class InMemoryErrorReport implements ErrorReport {
  readonly lines: ValidationError[] = [];
  closed = false;

  constructor(readonly path: string) {}

  async write(error: ValidationError): Promise<void> {
    await Promise.resolve();
    this.lines.push(error);
  }

  async close(): Promise<void> {
    await Promise.resolve();
    this.closed = true;
  }
}

export class InMemoryErrorReportWriter implements ErrorReportWriter {
  readonly reports: InMemoryErrorReport[] = [];

  async open(): Promise<InMemoryErrorReport> {
    await Promise.resolve();
    const report = new InMemoryErrorReport(`output/errors-${this.reports.length + 1}.csv`);
    this.reports.push(report);
    return report;
  }
}

export class FakeFileStorage implements FileStorage {
  readonly removed: string[] = [];

  constructor(private readonly readable = true) {}

  async isReadable(_path: string): Promise<boolean> {
    await Promise.resolve();
    return this.readable;
  }

  async remove(path: string): Promise<void> {
    await Promise.resolve();
    this.removed.push(path);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private next = 0;

  generate(): string {
    this.next += 1;
    return `id-${this.next}`;
  }
}

/** Every call advances the clock by `stepMs`; memory readings are replayed from a list. */
export class FakePerformanceMonitor implements PerformanceMonitor {
  private elapsed = 0;
  private readings = 0;

  constructor(
    private readonly stepMs = 10,
    private readonly memoryReadings: readonly number[] = [40],
  ) {}

  nowMs(): number {
    const now = this.elapsed;
    this.elapsed += this.stepMs;
    return now;
  }

  memoryUsageMB(): number {
    const reading =
      this.memoryReadings[Math.min(this.readings, this.memoryReadings.length - 1)] ?? 0;
    this.readings += 1;
    return reading;
  }
}

export class FixedClock implements Clock {
  constructor(private current = new Date('2026-01-01T12:00:00.000Z')) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class InMemoryImportJobRepository implements ImportJobRepository {
  readonly jobs = new Map<string, ImportJob>();
  saves = 0;

  async save(job: ImportJob): Promise<void> {
    await Promise.resolve();
    this.saves += 1;
    this.jobs.set(job.id, job);
  }

  async findById(id: string): Promise<ImportJob | null> {
    await Promise.resolve();
    return this.jobs.get(id) ?? null;
  }
}

type LogFn = Logger['info'];
type LogMock = jest.Mock<ReturnType<LogFn>, Parameters<LogFn>>;

export type LoggerMock = { [K in keyof Logger]: LogMock };

const logMock = (): LogMock => jest.fn<ReturnType<LogFn>, [LogContext, string]>();

export const createLoggerMock = (): LoggerMock => ({
  debug: logMock(),
  info: logMock(),
  warn: logMock(),
  error: logMock(),
});

export const validRow = (
  index: number,
  overrides: Partial<Omit<RawStudentRow, 'lineNumber'>> = {},
): Omit<RawStudentRow, 'lineNumber'> => ({
  name: 'Ana Souza',
  email: `student.${index}@school.edu`,
  enrollmentDate: '2024-02-01',
  courseId: 'COURSE-101',
  score: '88.5',
  ...overrides,
});
