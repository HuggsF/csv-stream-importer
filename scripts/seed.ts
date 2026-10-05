/**
 * Seeds a development database: applies migrations, generates a 10k-row CSV and imports it
 * through the real use case (same path as `npm run import`).
 *
 *   npm run seed                 # 10,000 rows
 *   npm run seed -- --rows 50000
 */
import { Command } from 'commander';
import { z } from 'zod';
import { buildContainer } from '@infrastructure/config/container';
import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import { migrateLatest } from '@infrastructure/database/migrator';
import { createLogger } from '@infrastructure/logging/logger';
import { formatImportSummary } from '@presentation/cli/import-summary.formatter';
import { generateStudentsCsv } from './lib/student-csv-generator';

const optionsSchema = z.object({
  rows: z.coerce.number().int().positive(),
  output: z.string().min(1),
});

const program = new Command()
  .name('seed')
  .option('-r, --rows <count>', 'rows to generate and import', '10000')
  .option('-o, --output <path>', 'where to write the generated CSV', './data/seed.csv')
  .action(async (rawOptions: unknown) => {
    const options = optionsSchema.parse(rawOptions);
    loadEnvFile();
    const config = loadConfig();
    const container = buildContainer(config, createLogger({ ...config.log, level: 'error' }));

    try {
      const applied = await migrateLatest(container.db);
      process.stdout.write(
        `Migrations applied: ${applied.length === 0 ? 'none' : applied.join(', ')}\n`,
      );

      await generateStudentsCsv({
        rows: options.rows,
        output: options.output,
        errorRate: 0.05,
        seed: 7,
      });
      const result = await container.importStudents.execute({ filePath: options.output });
      if (!result.success) {
        throw result.error;
      }
      process.stdout.write(formatImportSummary(result.data));
    } finally {
      await container.db.destroy();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `❌ Seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
