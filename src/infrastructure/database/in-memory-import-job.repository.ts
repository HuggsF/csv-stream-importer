import type { ImportJob } from '@domain/entities/import-job.entity';
import type { ImportJobRepository } from '@domain/repositories/import-job.repository';

/**
 * Job status store for the HTTP API. Jobs are kept in memory (they are transient by nature);
 * the oldest finished jobs are evicted once `maxJobs` is reached so memory stays bounded.
 * Swap for a MySQL/Redis adapter to share status across several instances.
 */
export class InMemoryImportJobRepository implements ImportJobRepository {
  private readonly jobs = new Map<string, ImportJob>();

  constructor(private readonly maxJobs = 1000) {}

  save(job: ImportJob): Promise<void> {
    this.jobs.delete(job.id);
    this.jobs.set(job.id, job);
    this.evictFinishedJobs();
    return Promise.resolve();
  }

  findById(id: string): Promise<ImportJob | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }

  get size(): number {
    return this.jobs.size;
  }

  private evictFinishedJobs(): void {
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= this.maxJobs) {
        return;
      }
      if (job.isFinished) {
        this.jobs.delete(id);
      }
    }
  }
}
