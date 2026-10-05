import { ImportJob } from '@domain/entities/import-job.entity';
import { InMemoryImportJobRepository } from '@infrastructure/database/in-memory-import-job.repository';

const job = (id: string): ImportJob =>
  ImportJob.create({ id, fileName: `${id}.csv`, createdAt: new Date(0) });

describe('InMemoryImportJobRepository', () => {
  it('saves and finds jobs by id', async () => {
    const repository = new InMemoryImportJobRepository();
    const saved = job('a');

    await repository.save(saved);

    expect(await repository.findById('a')).toBe(saved);
    expect(await repository.findById('missing')).toBeNull();
  });

  it('evicts the oldest finished jobs beyond capacity, never unfinished ones', async () => {
    const repository = new InMemoryImportJobRepository(2);
    const finished = job('finished');
    finished.markFailed('x', new Date(1));
    const pending = job('pending');

    await repository.save(pending);
    await repository.save(finished);
    await repository.save(job('newest'));

    expect(repository.size).toBe(2);
    expect(await repository.findById('finished')).toBeNull();
    expect(await repository.findById('pending')).not.toBeNull();
  });

  it('keeps growing when every job is still running (no data loss)', async () => {
    const repository = new InMemoryImportJobRepository(1);

    await repository.save(job('a'));
    await repository.save(job('b'));

    expect(repository.size).toBe(2);
  });
});
