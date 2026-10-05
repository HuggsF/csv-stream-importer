import '../../module-aliases';
import { Command } from 'commander';
import { createDefaultCliContext } from '@presentation/cli/cli-context';
import { EXIT_FAILURE, runImportCommand } from '@presentation/cli/commands/import.command';
import { runMigrateCommand } from '@presentation/cli/commands/migrate.command';

const context = createDefaultCliContext();
const program = new Command()
  .name('csv-stream-importer')
  .description('Stream large CSV files of students into MySQL with constant memory usage.');

program
  .command('import')
  .description('Import a students CSV file')
  .requiredOption('-f, --file <path>', 'path to the CSV file')
  .option('-b, --batch-size <rows>', 'rows per bulk INSERT (default: IMPORT_BATCH_SIZE or 1000)')
  .action(async (options: unknown) => {
    process.exitCode = await runImportCommand(options, context);
  });

program
  .command('migrate')
  .description('Apply database migrations')
  .option('--rollback', 'revert the last batch of migrations')
  .action(async (options: unknown) => {
    process.exitCode = await runMigrateCommand(options, context);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  context.stderr.write(`❌ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = EXIT_FAILURE;
});
