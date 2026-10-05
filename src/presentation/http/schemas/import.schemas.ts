import { z } from 'zod';

export const startImportQuerySchema = z.object({
  batchSize: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const jobIdParamsSchema = z.object({
  jobId: z.string().uuid(),
});
