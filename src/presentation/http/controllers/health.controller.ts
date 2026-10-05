import type { Request, Response } from 'express';
import type { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';

export class HealthController {
  constructor(private readonly checkHealth: Pick<CheckHealthUseCase, 'execute'>) {}

  /** GET /health — 200 when every dependency is up, 503 otherwise (load balancer friendly). */
  check = async (_request: Request, response: Response): Promise<void> => {
    const result = await this.checkHealth.execute();
    if (!result.success) {
      response.status(503).json({ status: 'degraded' });
      return;
    }
    response.status(result.data.status === 'ok' ? 200 : 503).json(result.data);
  };
}
