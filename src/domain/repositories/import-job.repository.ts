import type { ImportJob } from '@domain/entities/import-job.entity';

export interface ImportJobRepository {
  save(job: ImportJob): Promise<void>;
  findById(id: string): Promise<ImportJob | null>;
}
