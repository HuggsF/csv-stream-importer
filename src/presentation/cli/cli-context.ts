import type { Container } from '@infrastructure/config/container';
import { buildContainer } from '@infrastructure/config/container';
import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import { createLogger } from '@infrastructure/logging/logger';

export type OutputStream = { write(chunk: string): unknown };

/** What a CLI command needs from the outside world — injectable for tests. */
export type CliContext = {
  readonly createContainer: () => Container;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  readonly process: Pick<NodeJS.Process, 'once' | 'off'>;
};

export const createDefaultCliContext = (): CliContext => ({
  createContainer: () => {
    loadEnvFile();
    const config = loadConfig();
    return buildContainer(config, createLogger(config.log));
  },
  stdout: process.stdout,
  stderr: process.stderr,
  process,
});
