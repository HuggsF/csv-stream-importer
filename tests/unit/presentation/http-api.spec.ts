import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { HealthOutput } from '@application/dtos/health.dto';
import type { ImportJobStatusOutput } from '@application/dtos/import-job.dto';
import { ImportJobNotFoundError } from '@application/errors/import-job-not-found.error';
import { ImportJobRejectedError } from '@application/errors/import-job-rejected.error';
import type { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';
import type { GetImportJobStatusUseCase } from '@application/use-cases/get-import-job-status.use-case';
import type { StartImportJobUseCase } from '@application/use-cases/start-import-job.use-case';
import { fail, ok } from '@domain/shared/result';
import { createHttpApp } from '@presentation/http/app';
import type { ErrorResponseBody } from '@presentation/http/errors/http-error';
import { HealthController } from '@presentation/http/controllers/health.controller';
import { ImportController } from '@presentation/http/controllers/import.controller';
import { createLoggerMock } from '../../support/fakes';

type StartExecute = StartImportJobUseCase['execute'];
type StatusExecute = GetImportJobStatusUseCase['execute'];
type HealthExecute = CheckHealthUseCase['execute'];

const JOB_ID = '0192f1a4-5b6c-7d8e-9f01-23456789abcd';
const CSV = Buffer.from(
  'name,email,enrollment_date,course_id,score\nAna,a@b.co,2024-01-01,C1,90\n',
);

const jobStatus: ImportJobStatusOutput = {
  jobId: JOB_ID,
  fileName: 'students.csv',
  status: 'processing',
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:01.000Z',
  finishedAt: null,
  result: null,
  error: null,
};

type ErrorBody = ErrorResponseBody['error'] & { details?: { path: string }[] };

const errorOf = (response: { body: unknown }): ErrorBody =>
  (response.body as ErrorResponseBody).error as ErrorBody;

const healthy: HealthOutput = { status: 'ok', uptimeSeconds: 3, checks: { database: 'up' } };

describe('HTTP API', () => {
  let uploadDir: string;
  let startExecute: jest.Mock<ReturnType<StartExecute>, Parameters<StartExecute>>;
  let statusExecute: jest.Mock<ReturnType<StatusExecute>, Parameters<StatusExecute>>;
  let healthExecute: jest.Mock<ReturnType<HealthExecute>, Parameters<HealthExecute>>;
  let app: ReturnType<typeof createHttpApp>;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), 'csv-upload-'));
    startExecute = jest
      .fn<ReturnType<StartExecute>, Parameters<StartExecute>>()
      .mockResolvedValue(ok({ jobId: JOB_ID }));
    statusExecute = jest
      .fn<ReturnType<StatusExecute>, Parameters<StatusExecute>>()
      .mockResolvedValue(ok(jobStatus));
    healthExecute = jest
      .fn<ReturnType<HealthExecute>, Parameters<HealthExecute>>()
      .mockResolvedValue(ok(healthy));
    app = createHttpApp({
      logger: createLoggerMock(),
      healthController: new HealthController({ execute: healthExecute }),
      importController: new ImportController(
        { execute: startExecute },
        { execute: statusExecute },
        { directory: uploadDir, maxBytes: 1024 },
      ),
    });
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  describe('GET /health', () => {
    it('answers 200 when dependencies are up', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(healthy);
    });

    it('answers 503 when a dependency is down', async () => {
      healthExecute.mockResolvedValue(
        ok({ status: 'degraded', uptimeSeconds: 3, checks: { database: 'down' } }),
      );

      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ status: 'degraded' });
    });
  });

  describe('POST /api/import', () => {
    it('streams the upload to disk and answers 202 with the job id', async () => {
      const response = await request(app)
        .post('/api/import?batchSize=500')
        .attach('file', CSV, 'students.csv');

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ jobId: JOB_ID, statusUrl: `/api/import/${JOB_ID}/status` });
      expect(response.headers.location).toBe(`/api/import/${JOB_ID}/status`);
      const [input] = startExecute.mock.calls[0]!;
      expect(input.originalFileName).toBe('students.csv');
      expect(input.batchSize).toBe(500);
      expect(input.filePath.startsWith(uploadDir)).toBe(true);
      expect(input.filePath.endsWith('.csv')).toBe(true);
      expect(existsSync(input.filePath)).toBe(true);
    });

    it('rejects a body that is not multipart with 415', async () => {
      const response = await request(app).post('/api/import').send({ file: 'x' });

      expect(response.status).toBe(415);
      expect(errorOf(response).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rejects a non-csv file with 415', async () => {
      const response = await request(app)
        .post('/api/import')
        .attach('file', Buffer.from('hello'), 'notes.txt');

      expect(response.status).toBe(415);
      expect(errorOf(response).message).toBe('Only .csv files can be imported');
      expect(startExecute).not.toHaveBeenCalled();
    });

    it('requires the file field', async () => {
      const response = await request(app).post('/api/import').field('other', 'value');

      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('FILE_REQUIRED');
    });

    it('rejects files above the size limit with 413 and removes the partial file', async () => {
      const response = await request(app)
        .post('/api/import')
        .attach('file', Buffer.alloc(4096, 'a'), 'big.csv');

      expect(response.status).toBe(413);
      expect(errorOf(response).code).toBe('PAYLOAD_TOO_LARGE');
      expect(readdirSync(uploadDir)).toEqual([]);
    });

    it('validates the batchSize query parameter', async () => {
      const response = await request(app)
        .post('/api/import?batchSize=abc')
        .attach('file', CSV, 'students.csv');

      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
      expect(errorOf(response).details?.[0]?.path).toBe('batchSize');
    });

    it('answers 503 with Retry-After when the queue is full', async () => {
      startExecute.mockResolvedValue(fail(new ImportJobRejectedError('queue-full')));

      const response = await request(app).post('/api/import').attach('file', CSV, 'students.csv');

      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('30');
      expect(errorOf(response).code).toBe('IMPORT_JOB_REJECTED');
    });

    it('hides unexpected failures behind a generic 500', async () => {
      startExecute.mockRejectedValue(new Error('secret internals'));

      const response = await request(app).post('/api/import').attach('file', CSV, 'students.csv');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
    });
  });

  describe('GET /api/import/:jobId/status', () => {
    it('returns the job status', async () => {
      const response = await request(app).get(`/api/import/${JOB_ID}/status`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(jobStatus);
      expect(statusExecute).toHaveBeenCalledWith({ jobId: JOB_ID });
    });

    it('answers 404 for an unknown job', async () => {
      statusExecute.mockResolvedValue(fail(new ImportJobNotFoundError(JOB_ID)));

      const response = await request(app).get(`/api/import/${JOB_ID}/status`);

      expect(response.status).toBe(404);
      expect(errorOf(response).code).toBe('IMPORT_JOB_NOT_FOUND');
    });

    it('answers 400 for a malformed job id', async () => {
      const response = await request(app).get('/api/import/not-a-uuid/status');

      expect(response.status).toBe(400);
      expect(statusExecute).not.toHaveBeenCalled();
    });
  });

  it('answers 404 JSON for unknown routes', async () => {
    const response = await request(app).get('/nope');

    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('NOT_FOUND');
  });
});
