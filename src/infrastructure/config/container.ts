import type { Knex } from 'knex';
import type { Logger } from '@application/interfaces/logger';
import { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import { GetImportJobStatusUseCase } from '@application/use-cases/get-import-job-status.use-case';
import { ImportStudentsUseCase } from '@application/use-cases/import-students.use-case';
import { ProcessImportJobUseCase } from '@application/use-cases/process-import-job.use-case';
import { StartImportJobUseCase } from '@application/use-cases/start-import-job.use-case';
import type { AppConfig } from '@infrastructure/config/env';
import { CsvParserStreamReader } from '@infrastructure/csv/csv-parser-stream-reader';
import { InMemoryImportJobRepository } from '@infrastructure/database/in-memory-import-job.repository';
import { createDatabase, pingDatabase } from '@infrastructure/database/knex';
import { MySqlStudentRepository } from '@infrastructure/database/mysql-student.repository';
import { CsvErrorReportWriter } from '@infrastructure/filesystem/csv-error-report-writer';
import { NodeFileStorage } from '@infrastructure/filesystem/node-file-storage';
import { InProcessImportJobQueue } from '@infrastructure/queue/in-process-import-job-queue';
import { ProcessPerformanceMonitor } from '@infrastructure/system/process-performance-monitor';
import { SystemClock } from '@infrastructure/system/system-clock';
import { UuidV7IdGenerator } from '@infrastructure/system/uuid-v7-id-generator';

export type Container = {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly db: Knex;
  readonly studentRepository: MySqlStudentRepository;
  readonly importStudents: ImportStudentsUseCase;
  readonly startImportJob: StartImportJobUseCase;
  readonly getImportJobStatus: GetImportJobStatusUseCase;
  readonly checkHealth: CheckHealthUseCase;
  readonly jobQueue: InProcessImportJobQueue;
};

export type ContainerOverrides = {
  /** Reuse an existing pool (tests). */
  readonly db?: Knex;
};

/** Composition root: the only place where concrete adapters are wired to the use cases. */
export const buildContainer = (
  config: AppConfig,
  logger: Logger,
  overrides: ContainerOverrides = {},
): Container => {
  const db = overrides.db ?? createDatabase(config.database);
  const clock = new SystemClock();
  const idGenerator = new UuidV7IdGenerator();
  const performanceMonitor = new ProcessPerformanceMonitor();
  const fileStorage = new NodeFileStorage();
  const studentRepository = new MySqlStudentRepository(db);
  const jobRepository = new InMemoryImportJobRepository();

  const importStudents = new ImportStudentsUseCase(
    studentRepository,
    new CsvParserStreamReader({ maxRowBytes: config.import.csvMaxRowBytes }),
    logger,
    new CsvErrorReportWriter(config.import.errorReportDir, clock),
    fileStorage,
    idGenerator,
    performanceMonitor,
  );
  const processImportJob = new ProcessImportJobUseCase(
    jobRepository,
    importStudents,
    fileStorage,
    clock,
    logger,
  );
  const jobQueue = new InProcessImportJobQueue(
    processImportJob,
    {
      concurrency: config.import.queueConcurrency,
      maxPending: config.import.queueMaxPending,
    },
    logger,
  );

  return {
    config,
    logger,
    db,
    studentRepository,
    importStudents,
    startImportJob: new StartImportJobUseCase(
      jobRepository,
      jobQueue,
      fileStorage,
      idGenerator,
      clock,
      logger,
    ),
    getImportJobStatus: new GetImportJobStatusUseCase(jobRepository),
    checkHealth: new CheckHealthUseCase(
      [{ name: 'database', check: () => pingDatabase(db) }],
      performanceMonitor,
    ),
    jobQueue,
  };
};
