/**
 * Benchmark: readFileSync vs createReadStream on the same CSV.
 *
 *   npm run benchmark                         # uses ./data/students.csv (generated if missing)
 *   npm run benchmark -- --file x.csv --rows 100000
 *
 * Each strategy runs in its own child process (clean heap, comparable RSS), first with
 * Node's default heap settings, then with the 64 MB heap cap used by `npm run import`.
 * Results are printed as a table and written to benchmarks/results.md.
 */
import { execFile } from 'node:child_process';
import { access, stat, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { z } from 'zod';
import { generateStudentsCsv } from '../scripts/lib/student-csv-generator';
import type { StrategyMetrics, StrategyName } from './run-strategy';

const execFileAsync = promisify(execFile);
const RUNNER = join(__dirname, 'run-strategy.ts');
const RESULTS_FILE = join(__dirname, 'results.md');
/** Same V8 flags as the `import` npm scripts — see docs/adr/004-memory-budget-and-heap-tuning.md */
const HEAP_CAP_FLAGS = ['--max-old-space-size=64', '--max-semi-space-size=2'];

type RunOutcome =
  | { readonly ok: true; readonly metrics: StrategyMetrics }
  | { readonly ok: false; readonly reason: string };

const optionsSchema = z.object({
  file: z.string().min(1),
  rows: z.coerce.number().int().positive(),
});

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const runStrategy = async (
  strategy: StrategyName,
  file: string,
  nodeFlags: readonly string[] = [],
): Promise<RunOutcome> => {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [...nodeFlags, '--import', 'tsx', RUNNER, strategy, file],
      { maxBuffer: 1024 * 1024 },
    );
    return { ok: true, metrics: JSON.parse(stdout.trim()) as StrategyMetrics };
  } catch (error: unknown) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '';
    return {
      ok: false,
      reason: /heap out of memory|Reached heap limit/i.test(stderr)
        ? 'crashed: JavaScript heap out of memory'
        : `crashed: ${stderr.split('\n')[0] ?? 'unknown error'}`,
    };
  }
};

const formatMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`);
const ratio = (a: number, b: number): string => (b === 0 ? '—' : `${(a / b).toFixed(1)}×`);

const buildMainTable = (sync: StrategyMetrics, stream: StrategyMetrics): string => {
  const rows: [string, string, string, string][] = [
    ['Rows processed', sync.rows.toLocaleString('en-US'), stream.rows.toLocaleString('en-US'), ''],
    [
      'Peak memory (RSS)',
      `${sync.peakRssMB} MB`,
      `${stream.peakRssMB} MB`,
      ratio(sync.peakRssMB, stream.peakRssMB),
    ],
    [
      'Peak heap used',
      `${sync.peakHeapUsedMB} MB`,
      `${stream.peakHeapUsedMB} MB`,
      ratio(sync.peakHeapUsedMB, stream.peakHeapUsedMB),
    ],
    ['Total time', formatMs(sync.durationMs), formatMs(stream.durationMs), ''],
    [
      'Longest event loop block',
      formatMs(sync.maxEventLoopDelayMs),
      formatMs(stream.maxEventLoopDelayMs),
      ratio(sync.maxEventLoopDelayMs, stream.maxEventLoopDelayMs),
    ],
    [
      'p99 event loop delay',
      formatMs(sync.p99EventLoopDelayMs),
      formatMs(stream.p99EventLoopDelayMs),
      '',
    ],
    [
      'Valid / invalid rows',
      `${sync.valid} / ${sync.invalid}`,
      `${stream.valid} / ${stream.invalid}`,
      '',
    ],
  ];
  return [
    '| Metric | `readFileSync` | `createReadStream` | Sync / Stream |',
    '|---|---:|---:|---:|',
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n');
};

const describeCapped = (outcome: RunOutcome): string =>
  outcome.ok
    ? `✅ ${outcome.metrics.peakRssMB} MB RSS · ${formatMs(outcome.metrics.durationMs)}`
    : `💥 ${outcome.reason}`;

const buildCappedTable = (sync: RunOutcome, stream: RunOutcome): string =>
  [
    '| Heap capped at 64 MB | `readFileSync` | `createReadStream` |',
    '|---|---|---|',
    `| Result | ${describeCapped(sync)} | ${describeCapped(stream)} |`,
  ].join('\n');

const program = new Command()
  .name('sync-vs-stream')
  .option('-f, --file <path>', 'CSV file to benchmark', './data/students.csv')
  .option('-r, --rows <count>', 'rows to generate when the file does not exist', '500000')
  .action(async (rawOptions: unknown) => {
    const options = optionsSchema.parse(rawOptions);
    if (!(await fileExists(options.file))) {
      process.stdout.write(`Generating ${options.rows.toLocaleString('en-US')} rows…\n`);
      await generateStudentsCsv({
        rows: options.rows,
        output: options.file,
        errorRate: 0.05,
        seed: 42,
      });
    }
    const { size } = await stat(options.file);

    process.stdout.write('1/4 readFileSync (default heap)…\n');
    const sync = await runStrategy('sync', options.file);
    process.stdout.write('2/4 createReadStream (default heap)…\n');
    const stream = await runStrategy('stream', options.file);
    if (!sync.ok || !stream.ok) {
      throw new Error(`Benchmark run failed: ${JSON.stringify({ sync, stream })}`);
    }
    process.stdout.write('3/4 readFileSync (64 MB heap cap)…\n');
    const cappedSync = await runStrategy('sync', options.file, HEAP_CAP_FLAGS);
    process.stdout.write('4/4 createReadStream (64 MB heap cap)…\n');
    const cappedStream = await runStrategy('stream', options.file, HEAP_CAP_FLAGS);

    const mainTable = buildMainTable(sync.metrics, stream.metrics);
    const cappedTable = buildCappedTable(cappedSync, cappedStream);
    const environment = `Node ${process.version} · ${platform()} ${arch()} · ${cpus()[0]?.model.trim() ?? 'unknown CPU'} · ${Math.round(totalmem() / 1024 ** 3)} GB RAM`;
    const report = [
      '# Benchmark — `readFileSync` vs `createReadStream`',
      '',
      `- **File:** \`${options.file}\` — ${sync.metrics.rows.toLocaleString('en-US')} rows, ${(size / 1024 / 1024).toFixed(1)} MB`,
      `- **Environment:** ${environment}`,
      `- **Date:** ${new Date().toISOString().slice(0, 10)}`,
      '- **Workload:** parse + validate every row through the Domain (`Student.create`), batches of 1,000 handed to a simulated async insert (no database, to isolate the I/O strategy). Each run is a fresh process.',
      '',
      '## Default Node.js heap settings',
      '',
      mainTable,
      '',
      '## Production heap cap (`--max-old-space-size=64 --max-semi-space-size=2`)',
      '',
      cappedTable,
      '',
      '## Reading the numbers',
      '',
      '- **Peak memory** — `readFileSync` holds the whole file, every line and every parsed object at the same time: memory grows linearly with the file size. The stream holds one 64 KB chunk and one batch of 1,000 rows: memory is flat whatever the file size.',
      '- **Longest event loop block** — the longest period during which the process could not do anything else (answer HTTP requests, health checks, timers). The sync strategy freezes the process for the whole parse; the stream yields between chunks.',
      '- **Total time** — the stream pays a small per-row `await` cost; in the real import the database round-trips dominate anyway.',
      "- **Heap cap** — the streaming importer's live heap is ~16 MB, so it runs comfortably inside a 64 MB heap. The same cap kills the `readFileSync` approach.",
      '',
      'Reproduce with `npm run benchmark`.',
      '',
    ].join('\n');

    await writeFile(RESULTS_FILE, report, 'utf8');
    process.stdout.write(`\n${mainTable}\n\n${cappedTable}\n\nSaved to ${RESULTS_FILE}\n`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`❌ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
