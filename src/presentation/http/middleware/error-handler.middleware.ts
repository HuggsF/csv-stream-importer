import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '@application/interfaces/logger';
import { HttpError } from '@presentation/http/errors/http-error';
import type { ErrorResponseBody } from '@presentation/http/errors/http-error';

/** Errors raised by Express itself (e.g. undecodable URL params) carry an HTTP status. */
const hasClientErrorStatus = (error: unknown): error is { status: number } =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number' &&
  error.status >= 400 &&
  error.status < 500;

/** Last middleware: every error becomes a JSON body; internals are logged, never leaked. */
export const errorHandler =
  (logger: Logger) =>
  (error: unknown, request: Request, response: Response, _next: NextFunction): void => {
    if (error instanceof HttpError) {
      if (error.status >= 500) {
        logger.error({ err: error, path: request.path }, 'Request failed');
      }
      const body: ErrorResponseBody = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      };
      response.status(error.status).set(error.headers).json(body);
      return;
    }
    if (hasClientErrorStatus(error)) {
      response
        .status(error.status)
        .json({ error: { code: 'BAD_REQUEST', message: 'Bad request' } });
      return;
    }

    logger.error({ err: error, method: request.method, path: request.path }, 'Unhandled error');
    response
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  };
