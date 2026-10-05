import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CsvErrorReportWriter } from '@infrastructure/filesystem/csv-error-report-writer';
import { NodeFileStorage } from '@infrastructure/filesystem/node-file-storage';
import { FixedClock } from '../support/fakes';

describe('CsvErrorReportWriter (real files)', () => {
  let directory: string;

  beforeEach(async () => {
    directory = join(await mkdtemp(join(tmpdir(), 'error-report-')), 'nested', 'output');
  });

  afterEach(async () => {
    await rm(join(directory, '..', '..'), { recursive: true, force: true });
  });

  it('creates output/errors-<timestamp>.csv with a header and escaped rows', async () => {
    const writer = new CsvErrorReportWriter(directory, new FixedClock());

    const report = await writer.open();
    await report.write({ lineNumber: 7, field: 'name', value: 'Silva, Maria', message: 'Invalid' });
    await report.write({ lineNumber: 9, field: 'score', value: '=1+1', message: 'Score "bad"' });
    await report.close();

    expect(report.path).toBe(join(directory, 'errors-2026-01-01T12-00-00-000Z.csv'));
    expect(await readFile(report.path, 'utf8')).toBe(
      [
        'line_number,field,value,error_message',
        '7,name,"Silva, Maria",Invalid',
        `9,score,'=1+1,"Score ""bad"""`,
        '',
      ].join('\n'),
    );
  });

  it('never overwrites a report created in the same millisecond', async () => {
    const writer = new CsvErrorReportWriter(directory, new FixedClock());

    const first = await writer.open();
    const second = await writer.open();
    await Promise.all([first.close(), second.close()]);

    expect(first.path).not.toBe(second.path);
    expect((await readdir(directory)).sort()).toEqual([
      'errors-2026-01-01T12-00-00-000Z-1.csv',
      'errors-2026-01-01T12-00-00-000Z.csv',
    ]);
  });

  it('handles thousands of writes with backpressure', async () => {
    const report = await new CsvErrorReportWriter(directory, new FixedClock()).open();

    for (let line = 0; line < 20_000; line += 1) {
      await report.write({ lineNumber: line, field: 'email', value: 'x'.repeat(50), message: 'm' });
    }
    await report.close();

    const content = await readFile(report.path, 'utf8');
    expect(content.trimEnd().split('\n')).toHaveLength(20_001);
  });
});

describe('NodeFileStorage', () => {
  const storage = new NodeFileStorage();

  it('tells whether a path is a readable file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storage-'));
    const report = await new CsvErrorReportWriter(directory, new FixedClock()).open();
    await report.close();

    expect(await storage.isReadable(report.path)).toBe(true);
    expect(await storage.isReadable(directory)).toBe(false);
    expect(await storage.isReadable(join(directory, 'missing.csv'))).toBe(false);

    await storage.remove(report.path);
    await storage.remove(report.path);
    expect(await storage.isReadable(report.path)).toBe(false);
    await rm(directory, { recursive: true, force: true });
  });
});
