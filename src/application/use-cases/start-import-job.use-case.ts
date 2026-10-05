import type { StartImportJobInput, StartImportJobOutput } from '@application/dtos/import-job.dto';
import { ImportJobRejectedError } from '@application/errors/import-job-rejected.error';
import type { InvalidImportOptionsError } from '@application/errors/invalid-import-options.error';
import type { Clock } from '@application/interfaces/clock';
import type { FileStorage } from '@application/interfaces/file-storage';
import type { IdGenerator } from '@application/interfaces/id-generator';
import type { ImportJobQueue } from '@application/interfaces/import-job-queue';
import type { Logger } from '@application/interfaces/logger';
import { resolveBatchSize } from '@application/services/import-options';
import { ImportJob } from '@domain/entities/import-job.entity';
import type { InvalidFilePathError } from '@domain/errors/invalid-file-path.error';
import type { ImportJobRepository } from '@domain/repositories/import-job.repository';
import { fail, ok } from '@domain/shared/result';
import type { Failure, Result } from '@domain/shared/result';
import { FilePath } from '@domain/value-objects/file-path.value-object';

export type StartImportJobError =
  InvalidImportOptionsError | InvalidFilePathError | ImportJobRejectedError;

/**
 * Registers an uploaded CSV as a pending job and hands it to the background queue.
 * The upload is owned by the job from here on: if the job cannot be scheduled, the file is
 * discarded immediately; otherwise ProcessImportJobUseCase removes it once processed.
 */
export class StartImportJobUseCase {
  constructor(
    private readonly jobRepository: ImportJobRepository,
    private readonly jobQueue: ImportJobQueue,
    private readonly fileStorage: FileStorage,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(
    input: StartImportJobInput,
  ): Promise<Result<StartImportJobOutput, StartImportJobError>> {
    const batchSize = resolveBatchSize(input.batchSize);
    if (!batchSize.success) {
      return this.discardUpload(input.filePath, batchSize);
    }
    const filePath = FilePath.create(input.filePath);
    if (!filePath.success) {
      return this.discardUpload(input.filePath, filePath);
    }

    try {
      const job = ImportJob.create({
        id: this.idGenerator.generate(),
        fileName: input.originalFileName,
        createdAt: this.clock.now(),
      });
      await this.jobRepository.save(job);

      const outcome = this.jobQueue.enqueue({
        jobId: job.id,
        filePath: filePath.data.value,
        batchSize: batchSize.data,
      });
      if (outcome !== 'accepted') {
        const rejection = new ImportJobRejectedError(outcome);
        job.markFailed(rejection.message, this.clock.now());
        await this.jobRepository.save(job);
        this.logger.warn({ jobId: job.id, outcome }, 'Import job rejected');
        return await this.discardUpload(input.filePath, fail(rejection));
      }

      this.logger.info({ jobId: job.id, fileName: job.fileName }, 'Import job queued');
      return ok({ jobId: job.id });
    } catch (error: unknown) {
      this.logger.error({ err: error }, 'Could not schedule import job');
      return this.discardUpload(
        input.filePath,
        fail(new ImportJobRejectedError('unexpected', error)),
      );
    }
  }

  private async discardUpload<E>(filePath: string, failure: Failure<E>): Promise<Failure<E>> {
    try {
      await this.fileStorage.remove(filePath);
    } catch (error: unknown) {
      this.logger.warn({ err: error, filePath }, 'Could not remove rejected upload');
    }
    return failure;
  }
}
