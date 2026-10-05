import { stat } from 'node:fs/promises';
import { Command } from 'commander';
import { z } from 'zod';
import { generateStudentsCsv } from './lib/student-csv-generator';

const optionsSchema = z.object({
  rows: z.coerce.number().int().positive().max(50_000_000),
  output: z.string().min(1),
  errorRate: z.coerce.number().min(0).max(1),
  seed: z.coerce.number().int(),
});

const program = new Command()
  .name('generate-csv')
  .description('Generate a fake students CSV (~5% intentionally invalid rows)')
  .option('-r, --rows <count>', 'number of data rows', '500000')
  .option('-o, --output <path>', 'output file', './data/students.csv')
  .option('-e, --error-rate <ratio>', 'share of invalid rows (0..1)', '0.05')
  .option('-s, --seed <number>', 'faker seed (same seed = same file)', '42')
  .action(async (rawOptions: unknown) => {
    const options = optionsSchema.parse(rawOptions);
    const result = await generateStudentsCsv(options);
    const { size } = await stat(options.output);
    process.stdout.write(
      [
        `✅ Generated ${options.output}`,
        `   rows:         ${result.rows.toLocaleString('en-US')}`,
        `   invalid rows: ${result.invalidRows.toLocaleString('en-US')} (${((result.invalidRows / result.rows) * 100).toFixed(2)}%)`,
        `   size:         ${(size / 1024 / 1024).toFixed(1)} MB`,
        `   duration:     ${(result.durationMs / 1000).toFixed(1)}s`,
        '',
      ].join('\n'),
    );
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`❌ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
