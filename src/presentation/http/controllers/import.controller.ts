import type { Request, Response } from 'express';
import type { GetImportJobStatusUseCase } from '@application/use-cases/get-import-job-status.use-case';
import type { StartImportJobUseCase } from '@application/use-cases/start-import-job.use-case';
import { toHttpError } from '@presentation/http/errors/error-mapper';
import {
  jobIdParamsSchema,
  startImportQuerySchema,
} from '@presentation/http/schemas/import.schemas';
import { validate } from '@presentation/http/schemas/validate';
import { receiveCsvUpload } from '@presentation/http/upload/csv-upload';
import type { UploadOptions } from '@presentation/http/upload/csv-upload';

export class ImportController {
  constructor(
    private readonly startImportJob: Pick<StartImportJobUseCase, 'execute'>,
    private readonly getImportJobStatus: Pick<GetImportJobStatusUseCase, 'execute'>,
    private readonly uploadOptions: UploadOptions,
  ) {}

  /** POST /api/import — multipart/form-data with a `file` field. Answers 202 + jobId. */
  start = async (request: Request, response: Response): Promise<void> => {
    const query = validate(startImportQuerySchema, request.query);
    const upload = await receiveCsvUpload(request, this.uploadOptions);

    const result = await this.startImportJob.execute({
      filePath: upload.path,
      originalFileName: upload.originalName,
      batchSize: query.batchSize,
    });
    if (!result.success) {
      throw toHttpError(result.error);
    }

    const statusUrl = `/api/import/${result.data.jobId}/status`;
    response.status(202).location(statusUrl).json({ jobId: result.data.jobId, statusUrl });
  };

  /** GET /api/import/:jobId/status */
  status = async (request: Request, response: Response): Promise<void> => {
    const { jobId } = validate(jobIdParamsSchema, request.params);

    const result = await this.getImportJobStatus.execute({ jobId });
    if (!result.success) {
      throw toHttpError(result.error);
    }
    response.status(200).json(result.data);
  };
}
