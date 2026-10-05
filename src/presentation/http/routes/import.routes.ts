import { Router } from 'express';
import type { ImportController } from '@presentation/http/controllers/import.controller';

export const buildImportRouter = (controller: ImportController): Router => {
  const router = Router();
  router.post('/', controller.start);
  router.get('/:jobId/status', controller.status);
  return router;
};
