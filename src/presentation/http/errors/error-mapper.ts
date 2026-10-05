import type { ApplicationError } from '@application/errors/application.error';
import { ImportJobRejectedError } from '@application/errors/import-job-rejected.error';
import type { DomainError } from '@domain/errors/domain.error';
import { HttpError } from './http-error';

const RETRY_AFTER_SECONDS = '30';

const STATUS_BY_CODE: ReadonlyMap<string, number> = new Map([
  ['INVALID_IMPORT_OPTIONS', 400],
  ['INVALID_FILE_PATH', 400],
  ['IMPORT_JOB_NOT_FOUND', 404],
  ['INVALID_IMPORT_JOB_TRANSITION', 409],
]);

/** Translates use-case failures (Result errors) into HTTP semantics. */
export const toHttpError = (error: ApplicationError | DomainError): HttpError => {
  if (error instanceof ImportJobRejectedError) {
    return error.reason === 'unexpected'
      ? new HttpError(500, error.code, error.message)
      : new HttpError(503, error.code, error.message, undefined, {
          'Retry-After': RETRY_AFTER_SECONDS,
        });
  }
  const status = STATUS_BY_CODE.get(error.code);
  return status === undefined
    ? new HttpError(500, 'INTERNAL_ERROR', 'Internal server error')
    : new HttpError(status, error.code, error.message);
};
