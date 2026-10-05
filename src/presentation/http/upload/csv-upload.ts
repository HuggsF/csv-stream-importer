import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import type { Request } from 'express';
import { HttpError } from '@presentation/http/errors/http-error';

export type UploadOptions = {
  readonly directory: string;
  readonly maxBytes: number;
  readonly fieldName?: string;
};

export type UploadedCsv = {
  readonly path: string;
  readonly originalName: string;
  readonly sizeBytes: number;
};

const isCsvFileName = (fileName: string): boolean => fileName.toLowerCase().endsWith('.csv');

/**
 * Streams a multipart upload straight to disk — the request body is never buffered in
 * memory, so a 50 MB CSV costs the same RAM as a 50 KB one. Enforces a size limit and a
 * `.csv` extension, and removes partial files when the upload is rejected.
 */
export const receiveCsvUpload = async (
  request: Request,
  options: UploadOptions,
): Promise<UploadedCsv> => {
  const fieldName = options.fieldName ?? 'file';
  if (!request.is('multipart/form-data')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected a multipart/form-data body');
  }
  await mkdir(options.directory, { recursive: true });

  return new Promise<UploadedCsv>((resolve, reject) => {
    const parser = busboy({
      headers: request.headers,
      limits: { files: 1, fileSize: options.maxBytes, fields: 10, parts: 20 },
    });
    let upload: Promise<UploadedCsv> | null = null;
    let rejection: HttpError | null = null;

    parser.on('file', (name, stream, info) => {
      if (name !== fieldName || upload !== null || rejection !== null) {
        stream.resume();
        return;
      }
      if (!isCsvFileName(info.filename)) {
        stream.resume();
        rejection = new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only .csv files can be imported');
        return;
      }

      const path = join(options.directory, `${randomUUID()}.csv`);
      let sizeBytes = 0;
      stream.on('data', (chunk: Buffer) => {
        sizeBytes += chunk.length;
      });
      upload = pipeline(stream, createWriteStream(path)).then(async () => {
        if (stream.truncated) {
          await rm(path, { force: true });
          throw new HttpError(
            413,
            'PAYLOAD_TOO_LARGE',
            `File exceeds the maximum size of ${options.maxBytes} bytes`,
          );
        }
        return { path, originalName: info.filename, sizeBytes };
      });
      upload.catch(async () => {
        await rm(path, { force: true });
      });
    });

    parser.on('close', () => {
      if (rejection !== null) {
        reject(rejection);
        return;
      }
      if (upload === null) {
        reject(new HttpError(400, 'FILE_REQUIRED', `Missing "${fieldName}" file field`));
        return;
      }
      upload.then(resolve, reject);
    });
    parser.on('error', (error: unknown) => {
      reject(
        new HttpError(
          400,
          'INVALID_MULTIPART',
          error instanceof Error ? error.message : 'Malformed multipart body',
        ),
      );
    });

    request.pipe(parser);
  });
};
