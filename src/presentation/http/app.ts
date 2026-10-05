import express from 'express';
import type { Express } from 'express';
import type { Logger } from '@application/interfaces/logger';
import type { HealthController } from '@presentation/http/controllers/health.controller';
import type { ImportController } from '@presentation/http/controllers/import.controller';
import { errorHandler } from '@presentation/http/middleware/error-handler.middleware';
import { notFoundHandler } from '@presentation/http/middleware/not-found.middleware';
import { requestLogger } from '@presentation/http/middleware/request-logger.middleware';
import { buildHealthRouter } from '@presentation/http/routes/health.routes';
import { buildImportRouter } from '@presentation/http/routes/import.routes';

export type HttpAppDependencies = {
  readonly importController: ImportController;
  readonly healthController: HealthController;
  readonly logger: Logger;
};

export const createHttpApp = (dependencies: HttpAppDependencies): Express => {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(dependencies.logger));
  app.use(buildHealthRouter(dependencies.healthController));
  app.use('/api/import', buildImportRouter(dependencies.importController));

  app.use(notFoundHandler);
  app.use(errorHandler(dependencies.logger));
  return app;
};
