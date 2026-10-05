import './module-aliases';
import { buildContainer } from '@infrastructure/config/container';
import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import { migrateLatest } from '@infrastructure/database/migrator';
import { registerGracefulShutdown } from '@infrastructure/lifecycle/graceful-shutdown';
import { createLogger } from '@infrastructure/logging/logger';
import { buildHttpApp, closeServer, listen } from '@presentation/http/server';

/** HTTP entry point: POST /api/import, GET /api/import/:jobId/status, GET /health. */
const main = async (): Promise<void> => {
  loadEnvFile();
  const config = loadConfig();
  const logger = createLogger(config.log);
  const container = buildContainer(config, logger);

  if (config.database.migrateOnStart) {
    const applied = await migrateLatest(container.db);
    logger.info({ applied }, 'Database migrations applied');
  }

  const server = await listen(buildHttpApp(container), config.http.port);
  logger.info({ port: config.http.port, env: config.env }, 'HTTP server listening');

  registerGracefulShutdown({
    logger,
    timeoutMs: config.shutdownTimeoutMs,
    tasks: [
      { name: 'http-server', close: () => closeServer(server) },
      { name: 'import-queue', close: () => container.jobQueue.shutdown() },
      { name: 'database', close: () => container.db.destroy() },
    ],
  });
};

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: failed to start the server\n${String(error)}\n`);
  process.exit(1);
});
