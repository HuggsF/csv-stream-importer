import type { Server } from 'node:http';
import type { Express } from 'express';
import type { Container } from '@infrastructure/config/container';
import { createHttpApp } from '@presentation/http/app';
import { HealthController } from '@presentation/http/controllers/health.controller';
import { ImportController } from '@presentation/http/controllers/import.controller';

/** Wires controllers to the use cases exposed by the container. */
export const buildHttpApp = (container: Container): Express =>
  createHttpApp({
    logger: container.logger,
    healthController: new HealthController(container.checkHealth),
    importController: new ImportController(container.startImportJob, container.getImportJobStatus, {
      directory: container.config.import.uploadDir,
      maxBytes: container.config.import.uploadMaxBytes,
    }),
  });

export const listen = (app: Express, port: number): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = app.listen(port, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(server);
    });
  });

/** Stops accepting connections and resolves once in-flight requests are done. */
export const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeIdleConnections();
  });
