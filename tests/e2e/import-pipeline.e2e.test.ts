import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { HealthOutput } from '@application/dtos/health.dto';
import type { ImportJobStatusOutput } from '@application/dtos/import-job.dto';
import { buildContainer } from '@infrastructure/config/container';
import type { Container } from '@infrastructure/config/container';
import { loadConfig } from '@infrastructure/config/env';
import type { AppConfig } from '@infrastructure/config/env';
import { STUDENTS_TABLE } from '@infrastructure/database/mysql-student.repository';
import { createLogger } from '@infrastructure/logging/logger';
import type { CliContext } from '@presentation/cli/cli-context';
import { runImportCommand } from '@presentation/cli/commands/import.command';
import { runMigrateCommand } from '@presentation/cli/commands/migrate.command';
import { buildHttpApp } from '@presentation/http/server';
import { CONTAINER_STARTUP_TIMEOUT_MS, startTestDatabase } from '../support/mysql-container';
import type { TestDatabase } from '../support/mysql-container';

const VALID_ROWS = 2400;

/** 2,400 valid rows + 5 invalid rows + 3 duplicates of earlier emails, spread across batches. */
const buildCsv = (): string => {
  const lines = ['name,email,enrollment_date,course_id,score'];
  for (let index = 0; index < VALID_ROWS; index += 1) {
    lines.push(
      `Student Number,student.${index}@school.edu,2024-03-01,COURSE-${index % 7},${index % 101}`,
    );
    if (index === 100) lines.push('A,short-name@school.edu,2024-03-01,COURSE-1,50');
    if (index === 600) lines.push('Bad Email,not-an-email,2024-03-01,COURSE-1,50');
    if (index === 900) lines.push('Bad Score,bad.score@school.edu,2024-03-01,COURSE-1,101');
    if (index === 1500) lines.push('Bad Date,bad.date@school.edu,2024-02-30,COURSE-1,50');
    if (index === 2000) lines.push('Many Errors,,15/03/2024,,abc');
    if (index === 2100) lines.push('Dup One,student.5@school.edu,2024-03-01,COURSE-1,50');
    if (index === 2101) lines.push('Dup Two,STUDENT.2100@school.edu,2024-03-01,COURSE-1,50');
  }
  lines.push('Dup Three,student.2399@school.edu,2024-03-01,COURSE-1,50');
  return `${lines.join('\n')}\n`;
};

const TOTAL_ROWS = VALID_ROWS + 8;
const INVALID_ROWS = 8;

const silentContext = (
  createContainer: () => Container,
): CliContext & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    createContainer,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
    process: { once: () => process, off: () => process },
    out,
    err,
  };
};

describe('Import pipeline (CSV → Domain validation → MySQL)', () => {
  let database: TestDatabase;
  let workDir: string;
  let csvPath: string;
  let config: AppConfig;
  const logger = createLogger({ level: 'silent', pretty: false });
  const newContainer = (): Container => buildContainer(config, logger);

  beforeAll(async () => {
    database = await startTestDatabase();
    workDir = await mkdtemp(join(tmpdir(), 'csv-e2e-'));
    csvPath = join(workDir, 'students.csv');
    await writeFile(csvPath, buildCsv());
    config = loadConfig({
      LOG_LEVEL: 'silent',
      DB_HOST: database.config.host,
      DB_PORT: String(database.config.port),
      DB_USER: database.config.user,
      DB_PASSWORD: database.config.password,
      DB_NAME: database.config.name,
      DB_POOL_MIN: '0',
      ERROR_REPORT_DIR: join(workDir, 'output'),
      UPLOAD_DIR: join(workDir, 'uploads'),
    });
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await database.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await database.db(STUDENTS_TABLE).truncate();
  });

  describe('CLI', () => {
    it('imports valid rows in batches and writes every rejected row to the error report', async () => {
      const context = silentContext(newContainer);

      const exitCode = await runImportCommand({ file: csvPath, batchSize: '500' }, context);

      expect(exitCode).toBe(0);
      const summary = context.out.join('');
      expect(summary).toMatch(
        new RegExp(`Total processed:\\s+${TOTAL_ROWS.toLocaleString('en-US')}`),
      );
      expect(summary).toMatch(
        new RegExp(`Total imported:\\s+${VALID_ROWS.toLocaleString('en-US')}`),
      );
      expect(summary).toMatch(new RegExp(`Total errors:\\s+${INVALID_ROWS}`));

      const [{ total }] = (await database.db(STUDENTS_TABLE).count({ total: '*' })) as [
        { total: number | string },
      ];
      expect(Number(total)).toBe(VALID_ROWS);

      const reportPath = /Error report: (.+)/.exec(summary)?.[1]?.trim() ?? '';
      const report = (await readFile(reportPath, 'utf8')).trimEnd().split('\n');
      expect(report[0]).toBe('line_number,field,value,error_message');
      expect(report).toEqual(
        expect.arrayContaining([
          '103,name,A,Name must be at least 2 characters',
          '604,email,not-an-email,Email must be a valid address',
          '905,score,101,Score must be between 0 and 100',
          '1506,enrollment_date,2024-02-30,Enrollment date is not a valid calendar date',
          // student.5 was committed by an earlier batch → caught by the database lookup.
          '2108,email,student.5@school.edu,A student with this email is already registered',
          // student.2100 / student.2399 are still in the pending batch → caught in memory.
          '2110,email,student.2100@school.edu,Email appears more than once in the file',
          '2409,email,student.2399@school.edu,Email appears more than once in the file',
        ]),
      );
      // "Many Errors" row: one report line per invalid field.
      expect(report.filter((line) => line.startsWith('2007,'))).toHaveLength(4);
    });

    it('is idempotent: re-importing the same file inserts nothing new', async () => {
      await runImportCommand({ file: csvPath }, silentContext(newContainer));
      const second = silentContext(newContainer);

      const exitCode = await runImportCommand({ file: csvPath }, second);

      expect(exitCode).toBe(0);
      expect(second.out.join('')).toMatch(/Total imported:\s+0\b/);
      expect(second.out.join('')).toMatch(
        new RegExp(`Total errors:\\s+${TOTAL_ROWS.toLocaleString('en-US')}`),
      );
    });

    it('exits with 1 and a clear message for a missing file', async () => {
      const context = silentContext(newContainer);

      const exitCode = await runImportCommand({ file: join(workDir, 'nope.csv') }, context);

      expect(exitCode).toBe(1);
      expect(context.err.join('')).toContain('[INVALID_FILE_PATH]');
    });

    it('exits with 2 on invalid options without touching the database', async () => {
      const createContainer = jest.fn(newContainer);
      const context = silentContext(createContainer);

      const exitCode = await runImportCommand({ file: csvPath, batchSize: '0' }, context);

      expect(exitCode).toBe(2);
      expect(createContainer).not.toHaveBeenCalled();
    });

    it('reports that migrations are already applied', async () => {
      const context = silentContext(newContainer);

      expect(await runMigrateCommand({}, context)).toBe(0);
      expect(context.out.join('')).toBe('Database already up to date\n');
    });
  });

  describe('HTTP API', () => {
    let container: Container;

    beforeAll(() => {
      container = newContainer();
    });

    afterAll(async () => {
      await container.jobQueue.shutdown();
      await container.db.destroy();
    });

    it('uploads a CSV, processes it in the background and exposes the job status', async () => {
      const app = buildHttpApp(container);

      const health = await request(app).get('/health');
      expect(health.status).toBe(200);
      expect((health.body as HealthOutput).checks).toEqual({ database: 'up' });

      const accepted = await request(app)
        .post('/api/import?batchSize=1000')
        .attach('file', csvPath, 'students.csv');
      expect(accepted.status).toBe(202);
      const { jobId, statusUrl } = accepted.body as { jobId: string; statusUrl: string };

      let status: ImportJobStatusOutput | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await request(app).get(statusUrl);
        status = response.body as ImportJobStatusOutput;
        if (status.status === 'completed' || status.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(status).toMatchObject({
        jobId,
        fileName: 'students.csv',
        status: 'completed',
        error: null,
        result: {
          totalProcessed: TOTAL_ROWS,
          totalImported: VALID_ROWS,
          totalErrors: INVALID_ROWS,
          aborted: false,
        },
      });
      expect(status?.result?.errorReportPath).not.toBeNull();
      expect(existsSync(status?.result?.errorReportPath ?? '')).toBe(true);
      // The upload is deleted once processed.
      expect(await readdir(config.import.uploadDir)).toEqual([]);
    }, 60_000);
  });
});
