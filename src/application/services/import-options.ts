import { InvalidImportOptionsError } from '@application/errors/invalid-import-options.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/** Rows per multi-row INSERT — see docs/adr/002-bulk-insert-batch-size.md. */
export const DEFAULT_BATCH_SIZE = 1000;
/** 6 placeholders per row × 10 000 rows stays far below MySQL's 65 535 placeholder limit. */
export const MAX_BATCH_SIZE = 10_000;

export const resolveBatchSize = (
  batchSize: number | undefined,
): Result<number, InvalidImportOptionsError> => {
  const value = batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
    return fail(
      new InvalidImportOptionsError(
        `Batch size must be an integer between 1 and ${MAX_BATCH_SIZE}, received ${String(value)}`,
      ),
    );
  }
  return ok(value);
};
