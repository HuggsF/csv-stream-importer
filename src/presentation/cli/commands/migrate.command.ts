import { z } from 'zod';
import { migrateLatest, migrateRollback } from '@infrastructure/database/migrator';
import type { CliContext } from '@presentation/cli/cli-context';
import { EXIT_FAILURE, EXIT_OK } from './import.command';

const migrateOptionsSchema = z.object({ rollback: z.boolean().optional() });

/** `migrate [--rollback]` — applies (or reverts the last batch of) database migrations. */
export const runMigrateCommand = async (
  rawOptions: unknown,
  context: CliContext,
): Promise<number> => {
  const options = migrateOptionsSchema.parse(rawOptions);
  const container = context.createContainer();
  try {
    const names =
      options.rollback === true
        ? await migrateRollback(container.db)
        : await migrateLatest(container.db);
    const verb = options.rollback === true ? 'Rolled back' : 'Applied';
    context.stdout.write(
      names.length === 0
        ? 'Database already up to date\n'
        : `${verb} ${names.length} migration(s):\n${names.map((name) => `  - ${name}`).join('\n')}\n`,
    );
    return EXIT_OK;
  } catch (error: unknown) {
    context.stderr.write(
      `❌ Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_FAILURE;
  } finally {
    await container.db.destroy();
  }
};
