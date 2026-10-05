import type {
  ImportJobStatusOutput,
  ProcessImportJobInput,
} from '@application/dtos/import-job.dto';
import { ImportJobNotFoundError } from '@application/errors/import-job-not-found.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { Clock } from '@application/interfaces/clock';
import type { FileStorage } from '@application/interfaces/file-storage';
import type { Logger } from '@application/interfaces/logger';
import { toImportJobStatusOutput, toImportReport } from '@application/services/import-job.mapper';
import type { ImportStudentsUseCase } from '@application/use-cases/import-students.use-case';
import type { InvalidImportJobTransitionError } from '@domain/errors/invalid-import-job-transition.error';
import type { ImportJobRepository } from '@domain/repositories/import-job.repository';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export type ProcessImportJobError =
  ImportJobNotFoundError | InvalidImportJobTransitionError | UnexpectedError;

/**
 * Executes a queued job: runs the import, records the outcome on the job and always removes
 * the uploaded temporary file afterwards.
 */
export class ProcessImportJobUseCase {
  constructor(
    private readonly jobRepository: ImportJobRepository,
    private readonly importStudents: Pick<ImportStudentsUseCase, 'execute'>,
    private readonly fileStorage: FileStorage,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(
    input: ProcessImportJobInput,
  ): Promise<Result<ImportJobStatusOutput, ProcessImportJobError>> {
    try {
      const job = await this.jobRepository.findById(input.jobId);
      if (job === null) {
        return fail(new ImportJobNotFoundError(input.jobId));
      }
      if (input.signal?.aborted === true) {
        job.markFailed('Import cancelled before it started', this.clock.now());
        await this.jobRepository.save(job);
        return ok(toImportJobStatusOutput(job));
      }
      const started = job.start(this.clock.now());
      if (!started.success) {
        return started;
      }
      await this.jobRepository.save(job);

      const result = await this.importStudents.execute({
        filePath: input.filePath,
        batchSize: input.batchSize,
        signal: input.signal,
      });

      if (result.success) {
        const completed = job.complete(toImportReport(result.data), this.clock.now());
        if (!completed.success) {
          job.markFailed(completed.error.message, this.clock.now());
        }
      } else {
        job.markFailed(result.error.message, this.clock.now());
      }
      await this.jobRepository.save(job);

      this.logger.info({ jobId: job.id, status: job.status }, 'Import job finished');
      return ok(toImportJobStatusOutput(job));
    } catch (error: unknown) {
      this.logger.error({ err: error, jobId: input.jobId }, 'Import job crashed');
      return fail(new UnexpectedError(`Import job ${input.jobId}`, error));
    } finally {
      await this.removeUpload(input.filePath);
    }
  }

  private async removeUpload(filePath: string): Promise<void> {
    try {
      await this.fileStorage.remove(filePath);
    } catch (error: unknown) {
      this.logger.warn({ err: error, filePath }, 'Could not remove uploaded file');
    }
  }
}
