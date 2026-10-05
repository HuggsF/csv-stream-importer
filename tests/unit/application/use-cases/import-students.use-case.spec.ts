import { ImportFailedError } from '@application/errors/import-failed.error';
import { InvalidImportOptionsError } from '@application/errors/invalid-import-options.error';
import {
  ImportStudentsUseCase,
  MAX_ERRORS_IN_RESULT,
  MAX_ROW_WARNINGS,
} from '@application/use-cases/import-students.use-case';
import type { Student } from '@domain/entities/student.entity';
import { InvalidFilePathError } from '@domain/errors/invalid-file-path.error';
import {
  ArrayCsvReader,
  FakeFileStorage,
  FakePerformanceMonitor,
  InMemoryErrorReportWriter,
  InMemoryStudentRepository,
  SequentialIdGenerator,
  createLoggerMock,
  validRow,
} from '../../../support/fakes';
import type { LoggerMock } from '../../../support/fakes';
import type { RawStudentRow } from '@application/interfaces/csv-stream-reader';

type Row = Omit<RawStudentRow, 'lineNumber'>;

const FILE = './data/students.csv';

const rows = (count: number, start = 0): Row[] =>
  Array.from({ length: count }, (_, index) => validRow(start + index));

type Sut = {
  useCase: ImportStudentsUseCase;
  repository: InMemoryStudentRepository;
  reader: ArrayCsvReader;
  reportWriter: InMemoryErrorReportWriter;
  logger: LoggerMock;
};

const makeSut = (
  input: Row[],
  options: {
    repository?: InMemoryStudentRepository;
    reader?: ArrayCsvReader;
    fileStorage?: FakeFileStorage;
    performance?: FakePerformanceMonitor;
  } = {},
): Sut => {
  const repository = options.repository ?? new InMemoryStudentRepository();
  const reader = options.reader ?? new ArrayCsvReader(input);
  const reportWriter = new InMemoryErrorReportWriter();
  const logger = createLoggerMock();
  const useCase = new ImportStudentsUseCase(
    repository,
    reader,
    logger,
    reportWriter,
    options.fileStorage ?? new FakeFileStorage(),
    new SequentialIdGenerator(),
    options.performance ?? new FakePerformanceMonitor(),
  );
  return { useCase, repository, reader, reportWriter, logger };
};

describe('ImportStudentsUseCase', () => {
  describe('happy path', () => {
    it('imports every valid row in batches of the configured size', async () => {
      const { useCase, repository, reportWriter } = makeSut(rows(5));

      const result = await useCase.execute({ filePath: FILE, batchSize: 2 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject({
          totalProcessed: 5,
          totalImported: 5,
          totalErrors: 0,
          errors: [],
          errorReportPath: null,
          aborted: false,
        });
      }
      expect(repository.insertedBatches).toEqual([2, 2, 1]);
      expect(await repository.count()).toBe(5);
      expect(reportWriter.reports).toHaveLength(0);
    });

    it('uses a batch size of 1000 by default', async () => {
      const { useCase, repository } = makeSut(rows(2500));

      await useCase.execute({ filePath: FILE });

      expect(repository.insertedBatches).toEqual([1000, 1000, 500]);
    });

    it('normalises values through the domain before persisting', async () => {
      const { useCase, repository } = makeSut([
        validRow(1, { name: '  Maria   Clara ', email: ' MARIA@School.EDU ', score: '70.50' }),
      ]);

      await useCase.execute({ filePath: FILE });

      const stored = (await repository.findByEmail('maria@school.edu'))!;
      expect(stored.name.value).toBe('Maria Clara');
      expect(stored.score.value).toBe(70.5);
      expect(stored.id).toBe('id-1');
    });

    it('reports duration, throughput and peak memory', async () => {
      const performance = new FakePerformanceMonitor(250, [41.26, 55.55, 48]);
      const { useCase } = makeSut(rows(4), { performance });

      const result = await useCase.execute({ filePath: FILE, batchSize: 2 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.durationMs).toBe(250);
        expect(result.data.rowsPerSecond).toBe(16);
        expect(result.data.peakMemoryMB).toBe(55.6);
      }
    });

    it('returns success with zero counters for an empty file', async () => {
      const { useCase, repository, reportWriter } = makeSut([]);

      const result = await useCase.execute({ filePath: FILE });

      expect(result.success && result.data).toMatchObject({
        totalProcessed: 0,
        totalImported: 0,
        totalErrors: 0,
        errors: [],
      });
      expect(repository.insertedBatches).toEqual([]);
      expect(repository.existingEmailLookups).toBe(0);
      expect(reportWriter.reports).toHaveLength(0);
    });
  });

  describe('partial failures', () => {
    it('skips invalid rows, reports every violation and imports the rest', async () => {
      const input = [
        validRow(0),
        validRow(1, { email: 'broken-email', score: '120' }),
        validRow(2),
        validRow(3, { name: 'J0hn' }),
      ];
      const { useCase, repository, reportWriter, logger } = makeSut(input);

      const result = await useCase.execute({ filePath: FILE });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.totalProcessed).toBe(4);
      expect(result.data.totalImported).toBe(2);
      expect(result.data.totalErrors).toBe(2);
      expect(result.data.errors).toEqual([
        {
          lineNumber: 3,
          field: 'email',
          value: 'broken-email',
          message: 'Email must be a valid address',
        },
        {
          lineNumber: 3,
          field: 'score',
          value: '120',
          message: 'Score must be between 0 and 100',
        },
        {
          lineNumber: 5,
          field: 'name',
          value: 'J0hn',
          message: 'Name may only contain letters, spaces, hyphens and apostrophes',
        },
      ]);
      expect(await repository.count()).toBe(2);

      const [report] = reportWriter.reports;
      expect(result.data.errorReportPath).toBe(report?.path);
      expect(report?.lines).toEqual(result.data.errors);
      expect(report?.closed).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ lineNumber: 3 }),
        'Row skipped',
      );
    });

    it('treats missing columns as required-field violations', async () => {
      const { useCase } = makeSut([{ name: 'Ana Souza' }]);

      const result = await useCase.execute({ filePath: FILE });

      expect(result.success && result.data.errors.map((error) => error.message)).toEqual([
        'Email is required',
        'Enrollment date is required',
        'Course id is required',
        'Score is required',
      ]);
    });

    it('rejects duplicated emails inside the same batch (first occurrence wins)', async () => {
      const input = [
        validRow(0, { email: 'same@school.edu' }),
        validRow(1, { email: 'SAME@school.edu' }),
      ];
      const { useCase, repository } = makeSut(input);

      const result = await useCase.execute({ filePath: FILE });

      expect(result.success && result.data.errors).toEqual([
        {
          lineNumber: 3,
          field: 'email',
          value: 'same@school.edu',
          message: 'Email appears more than once in the file',
        },
      ]);
      expect(await repository.count()).toBe(1);
    });

    it('rejects duplicates that span different batches and pre-existing students', async () => {
      const repository = new InMemoryStudentRepository();
      const seed = makeSut([validRow(99, { email: 'existing@school.edu' })], { repository });
      await seed.useCase.execute({ filePath: FILE });

      const input = [
        validRow(0, { email: 'a@school.edu' }),
        validRow(1, { email: 'b@school.edu' }),
        validRow(2, { email: 'a@school.edu' }),
        validRow(3, { email: 'existing@school.edu' }),
      ];
      const { useCase } = makeSut(input, { repository });

      const result = await useCase.execute({ filePath: FILE, batchSize: 2 });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.totalImported).toBe(2);
      expect(result.data.totalErrors).toBe(2);
      expect(
        result.data.errors.map(({ lineNumber, message }) => ({ lineNumber, message })),
      ).toEqual([
        { lineNumber: 4, message: 'A student with this email is already registered' },
        { lineNumber: 5, message: 'A student with this email is already registered' },
      ]);
      expect(await repository.count()).toBe(3);
    });

    it('counts rows silently skipped by the database as errors', async () => {
      class RacingRepository extends InMemoryStudentRepository {
        override async bulkInsert(students: Student[]): Promise<number> {
          const inserted = await super.bulkInsert(students);
          return inserted - 1;
        }
      }
      const { useCase, logger } = makeSut(rows(3), { repository: new RacingRepository() });

      const result = await useCase.execute({ filePath: FILE });

      expect(result.success && result.data).toMatchObject({
        totalProcessed: 3,
        totalImported: 2,
        totalErrors: 1,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { skipped: 1, firstLine: 2 },
        expect.stringContaining('skipped by the database'),
      );
    });

    it('bounds the errors returned and the warnings logged, but reports every error', async () => {
      const invalidRows = Array.from({ length: MAX_ERRORS_IN_RESULT + 50 }, (_, index) =>
        validRow(index, { score: 'n/a' }),
      );
      const { useCase, reportWriter, logger } = makeSut(invalidRows);

      const result = await useCase.execute({ filePath: FILE });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.totalErrors).toBe(150);
      expect(result.data.errors).toHaveLength(MAX_ERRORS_IN_RESULT);
      expect(reportWriter.reports[0]?.lines).toHaveLength(150);
      const rowWarnings = logger.warn.mock.calls.filter(([, message]) => message === 'Row skipped');
      expect(rowWarnings).toHaveLength(MAX_ROW_WARNINGS);
      expect(logger.warn).toHaveBeenCalledWith(
        { errorReportPath: 'output/errors-1.csv' },
        'Further skipped rows are only written to the error report',
      );
    });
  });

  describe('streaming behaviour', () => {
    it('does not read ahead while a batch is being inserted (backpressure)', async () => {
      let markInsertStarted!: () => void;
      let releaseInsert!: () => void;
      const insertStarted = new Promise<void>((resolve) => {
        markInsertStarted = resolve;
      });
      const insertReleased = new Promise<void>((resolve) => {
        releaseInsert = resolve;
      });
      class SlowRepository extends InMemoryStudentRepository {
        override async bulkInsert(students: Student[]): Promise<number> {
          markInsertStarted();
          await insertReleased;
          return super.bulkInsert(students);
        }
      }
      const reader = new ArrayCsvReader(rows(10));
      const { useCase } = makeSut([], { reader, repository: new SlowRepository() });

      const execution = useCase.execute({ filePath: FILE, batchSize: 3 });
      await insertStarted;

      expect(reader.pulled).toBe(3);
      releaseInsert();
      const result = await execution;
      expect(result.success && result.data.totalImported).toBe(10);
      expect(reader.pulled).toBe(10);
    });

    it('logs progress every 10,000 rows', async () => {
      const { useCase, logger } = makeSut(rows(20_000));

      await useCase.execute({ filePath: FILE });

      const progressLogs = logger.info.mock.calls.filter(
        ([, message]) => message === 'Import progress',
      );
      expect(progressLogs.map(([context]) => context.processed)).toEqual([10_000, 20_000]);
    });

    it('stops reading when aborted and still flushes rows already validated', async () => {
      const controller = new AbortController();
      const reader = new ArrayCsvReader(rows(10));
      const repository = new InMemoryStudentRepository();
      const originalFind = repository.findExistingEmails.bind(repository);
      const { useCase, logger } = makeSut([], { reader, repository });
      jest.spyOn(repository, 'findExistingEmails').mockImplementation(async (emails) => {
        controller.abort();
        return originalFind(emails);
      });

      const result = await useCase.execute({
        filePath: FILE,
        batchSize: 4,
        signal: controller.signal,
      });

      expect(result.success && result.data).toMatchObject({
        totalProcessed: 4,
        totalImported: 4,
        aborted: true,
      });
      expect(reader.pulled).toBe(5);
      expect(logger.info).toHaveBeenCalledWith(expect.any(Object), 'Import aborted');
    });
  });

  describe('invalid input', () => {
    it.each([0, -1, 1.5, 10_001])('rejects batch size %p', async (batchSize) => {
      const { useCase, reader } = makeSut(rows(1));

      const result = await useCase.execute({ filePath: FILE, batchSize });

      expect(result.success).toBe(false);
      expect(!result.success && result.error).toBeInstanceOf(InvalidImportOptionsError);
      expect(reader.pulled).toBe(0);
    });

    it('rejects a file without .csv extension', async () => {
      const { useCase } = makeSut(rows(1));

      const result = await useCase.execute({ filePath: './data/students.xlsx' });

      expect(!result.success && result.error).toBeInstanceOf(InvalidFilePathError);
    });

    it('rejects a file that cannot be read', async () => {
      const { useCase } = makeSut(rows(1), { fileStorage: new FakeFileStorage(false) });

      const result = await useCase.execute({ filePath: FILE });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(InvalidFilePathError);
        expect(result.error.message).toBe('File does not exist or is not readable');
      }
    });
  });

  describe('infrastructure failures', () => {
    it('returns ImportFailedError with progress when the stream breaks', async () => {
      const input = [...rows(3), validRow(3, { score: 'bad' }), ...rows(2, 10)];
      const failingReader = new ArrayCsvReader(input, 4);
      const { useCase, reportWriter, logger } = makeSut([], { reader: failingReader });

      const result = await useCase.execute({ filePath: FILE, batchSize: 2 });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBeInstanceOf(ImportFailedError);
      expect(result.error.message).toBe('Import failed after 4 rows: Unexpected end of CSV stream');
      expect((result.error as ImportFailedError).progress).toEqual({
        totalProcessed: 4,
        totalImported: 2,
        totalErrors: 1,
      });
      expect(reportWriter.reports[0]?.closed).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(expect.any(Object), 'Import failed');
    });

    it('returns ImportFailedError when the database is unavailable', async () => {
      const repository = new InMemoryStudentRepository();
      jest.spyOn(repository, 'bulkInsert').mockRejectedValue(new Error('ECONNREFUSED'));
      const { useCase } = makeSut(rows(2), { repository });

      const result = await useCase.execute({ filePath: FILE });

      expect(!result.success && result.error.message).toBe(
        'Import failed after 2 rows: ECONNREFUSED',
      );
    });

    it('wraps non-Error rejections too', async () => {
      const repository = new InMemoryStudentRepository();
      jest.spyOn(repository, 'findExistingEmails').mockRejectedValue('socket hang up');
      const { useCase } = makeSut(rows(1), { repository });

      const result = await useCase.execute({ filePath: FILE });

      expect(!result.success && result.error.message).toBe(
        'Import failed after 1 rows: socket hang up',
      );
    });

    it('logs but does not fail when the error report cannot be closed', async () => {
      const { useCase, reportWriter, logger } = makeSut([validRow(0, { score: 'x' })]);
      const open = reportWriter.open.bind(reportWriter);
      jest.spyOn(reportWriter, 'open').mockImplementation(async () => {
        const report = await open();
        jest.spyOn(report, 'close').mockRejectedValue(new Error('EIO'));
        return report;
      });

      const result = await useCase.execute({ filePath: FILE });

      expect(result.success).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'output/errors-1.csv' }),
        'Could not close error report',
      );
    });
  });
});
