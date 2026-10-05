/**
 * Runs ONE import strategy in an isolated process and prints its metrics as JSON.
 * Spawned by sync-vs-stream.ts so each strategy starts from a clean heap.
 *
 * Both strategies parse + validate every row through the Domain (Student.create) and
 * "insert" valid rows in batches of 1,000 (no database: this isolates the I/O strategy).
 *
 *  - sync:   readFileSync → split('\n') → rows[] → validate all → students[] → batches
 *            (the naive approach: the whole file and every object live in memory at once)
 *  - stream: createReadStream → csv-parser → for await → validate → batch[1000] → flush
 */
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Student } from '@domain/entities/student.entity';
import type { InvalidStudentError } from '@domain/errors/invalid-student.error';
import type { Result } from '@domain/shared/result';
import { CsvParserStreamReader } from '@infrastructure/csv/csv-parser-stream-reader';

const BATCH_SIZE = 1000;
const SAMPLE_EVERY_ROWS = 5000;
const MB = 1024 * 1024;

export type StrategyName = 'sync' | 'stream';

export type StrategyMetrics = {
  readonly strategy: StrategyName;
  readonly rows: number;
  readonly valid: number;
  readonly invalid: number;
  readonly durationMs: number;
  readonly peakRssMB: number;
  readonly peakHeapUsedMB: number;
  readonly maxEventLoopDelayMs: number;
  readonly p99EventLoopDelayMs: number;
};

type Counters = { rows: number; valid: number; invalid: number };

const memory = { peakRss: 0, peakHeap: 0 };
const sampleMemory = (): void => {
  const usage = process.memoryUsage();
  memory.peakRss = Math.max(memory.peakRss, usage.rss);
  memory.peakHeap = Math.max(memory.peakHeap, usage.heapUsed);
};

type CsvRow = {
  readonly name?: string;
  readonly email?: string;
  readonly enrollment_date?: string;
  readonly course_id?: string;
  readonly score?: string;
};

const validate = (row: CsvRow, index: number): Result<Student, InvalidStudentError> =>
  Student.create({
    id: `bench-${index}`,
    name: row.name ?? '',
    email: row.email ?? '',
    enrollmentDate: row.enrollment_date ?? '',
    courseId: row.course_id ?? '',
    score: row.score ?? '',
  });

/** Simulates the async INSERT round-trip so the stream strategy really yields to the loop. */
const fakeInsert = async (batch: Student[]): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  batch.length = 0;
};

const runSync = async (filePath: string): Promise<Counters> => {
  const content = readFileSync(filePath, 'utf8');
  sampleMemory();
  const [headerLine = '', ...lines] = content.split('\n');
  const headers = headerLine.split(',');
  const rows = lines
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const cells = line.split(',');
      return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    });
  sampleMemory();

  const students: Student[] = [];
  let invalid = 0;
  rows.forEach((row, index) => {
    const result = validate(row, index);
    if (result.success) {
      students.push(result.data);
    } else {
      invalid += 1;
    }
    if (index % SAMPLE_EVERY_ROWS === 0) {
      sampleMemory();
    }
  });
  sampleMemory();
  for (let start = 0; start < students.length; start += BATCH_SIZE) {
    await fakeInsert(students.slice(start, start + BATCH_SIZE));
  }
  return { rows: rows.length, valid: students.length, invalid };
};

const runStream = async (filePath: string): Promise<Counters> => {
  const reader = new CsvParserStreamReader({ maxRowBytes: 64 * 1024 });
  const counters: Counters = { rows: 0, valid: 0, invalid: 0 };
  let batch: Student[] = [];

  for await (const row of reader.read(filePath)) {
    const result = validate(
      {
        name: row.name,
        email: row.email,
        enrollment_date: row.enrollmentDate,
        course_id: row.courseId,
        score: row.score,
      },
      counters.rows,
    );
    counters.rows += 1;
    if (result.success) {
      counters.valid += 1;
      batch.push(result.data);
    } else {
      counters.invalid += 1;
    }
    if (batch.length >= BATCH_SIZE) {
      await fakeInsert(batch);
      batch = [];
    }
    if (counters.rows % SAMPLE_EVERY_ROWS === 0) {
      sampleMemory();
    }
  }
  await fakeInsert(batch);
  return counters;
};

const HEARTBEAT_MS = 5;

/**
 * Detects event-loop blocking from the outside: a 5 ms timer should fire every 5 ms; any
 * extra gap between two ticks is time during which the process could not run anything else.
 */
const startHeartbeat = (): { stop: () => number } => {
  let lastTick = performance.now();
  let maxBlock = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxBlock = Math.max(maxBlock, now - lastTick - HEARTBEAT_MS);
    lastTick = now;
  }, HEARTBEAT_MS);
  return {
    stop: (): number => {
      clearInterval(timer);
      return Math.max(maxBlock, performance.now() - lastTick - HEARTBEAT_MS);
    },
  };
};

const main = async (): Promise<void> => {
  const [strategy, filePath] = process.argv.slice(2);
  if ((strategy !== 'sync' && strategy !== 'stream') || filePath === undefined) {
    throw new Error('usage: run-strategy.ts <sync|stream> <file.csv>');
  }

  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  const sampler = setInterval(sampleMemory, 25);
  loopDelay.enable();
  const heartbeat = startHeartbeat();
  // Let both probes tick once: a histogram that has not ticked yet ignores the first block.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  sampleMemory();
  const startedAt = performance.now();

  const counters = strategy === 'sync' ? await runSync(filePath) : await runStream(filePath);

  const durationMs = performance.now() - startedAt;
  // One more tick so a block at the very end is observed too.
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  const maxBlockMs = heartbeat.stop();
  sampleMemory();
  clearInterval(sampler);
  loopDelay.disable();

  const metrics: StrategyMetrics = {
    strategy,
    ...counters,
    durationMs: Math.round(durationMs),
    peakRssMB: Math.round((memory.peakRss / MB) * 10) / 10,
    peakHeapUsedMB: Math.round((memory.peakHeap / MB) * 10) / 10,
    maxEventLoopDelayMs: Math.round(Math.max(maxBlockMs, loopDelay.max / 1e6)),
    p99EventLoopDelayMs: Math.round(loopDelay.percentile(99) / 1e6),
  };
  process.stdout.write(`${JSON.stringify(metrics)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
