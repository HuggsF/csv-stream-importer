import type {
  GetImportJobStatusInput,
  ImportJobStatusOutput,
} from '@application/dtos/import-job.dto';
import { ImportJobNotFoundError } from '@application/errors/import-job-not-found.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import { toImportJobStatusOutput } from '@application/services/import-job.mapper';
import type { ImportJobRepository } from '@domain/repositories/import-job.repository';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export class GetImportJobStatusUseCase {
  constructor(private readonly jobRepository: ImportJobRepository) {}

  async execute(
    input: GetImportJobStatusInput,
  ): Promise<Result<ImportJobStatusOutput, ImportJobNotFoundError | UnexpectedError>> {
    try {
      const job = await this.jobRepository.findById(input.jobId);
      if (job === null) {
        return fail(new ImportJobNotFoundError(input.jobId));
      }
      return ok(toImportJobStatusOutput(job));
    } catch (error: unknown) {
      return fail(new UnexpectedError('Loading the import job', error));
    }
  }
}
