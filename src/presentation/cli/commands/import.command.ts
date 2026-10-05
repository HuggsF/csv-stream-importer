import { z } from 'zod';
import type { CliContext } from '@presentation/cli/cli-context';
import { formatImportSummary } from '@presentation/cli/import-summary.formatter';

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
/** Conventional exit code for "terminated by SIGINT". */
export const EXIT_INTERRUPTED = 130;

const importOptionsSchema = z.object({
  file: z.string().min(1, 'is required'),
  batchSize: z.coerce.number().int().min(1).max(10_000).optional(),
});

/**
 * `import --file <csv> [--batch-size <n>]`.
 * Ctrl+C aborts gracefully: the batch in progress is flushed, the error report is closed and
 * the summary is still printed. A second Ctrl+C kills the process immediately.
 */
export const runImportCommand = async (
  rawOptions: unknown,
  context: CliContext,
): Promise<number> => {
  const options = importOptionsSchema.safeParse(rawOptions);
  if (!options.success) {
    const issues = options.error.issues.map(
      (issue) => `--${issue.path.join('.')} ${issue.message}`,
    );
    context.stderr.write(`Invalid options: ${issues.join(', ')}\n`);
    return EXIT_USAGE;
  }

  const container = context.createContainer();
  const controller = new AbortController();
  const onSignal = (): void => {
    container.logger.warn({}, 'Interrupt received: finishing the current batch, then stopping');
    controller.abort();
  };
  context.process.once('SIGINT', onSignal);
  context.process.once('SIGTERM', onSignal);

  try {
    const result = await container.importStudents.execute({
      filePath: options.data.file,
      batchSize: options.data.batchSize ?? container.config.import.batchSize,
      signal: controller.signal,
    });

    if (!result.success) {
      context.stderr.write(`❌ Import failed [${result.error.code}]: ${result.error.message}\n`);
      return EXIT_FAILURE;
    }
    context.stdout.write(formatImportSummary(result.data));
    return result.data.aborted ? EXIT_INTERRUPTED : EXIT_OK;
  } finally {
    context.process.off('SIGINT', onSignal);
    context.process.off('SIGTERM', onSignal);
    await container.db.destroy();
  }
};
