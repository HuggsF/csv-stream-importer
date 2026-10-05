import type { DependencyStatus, HealthOutput } from '@application/dtos/health.dto';
import type { HealthIndicator } from '@application/interfaces/health-indicator';
import type { PerformanceMonitor } from '@application/interfaces/performance-monitor';
import { ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/** Checks every dependency in parallel, each bounded by a timeout so /health never hangs. */
export class CheckHealthUseCase {
  constructor(
    private readonly indicators: readonly HealthIndicator[],
    private readonly performanceMonitor: Pick<PerformanceMonitor, 'nowMs'>,
    private readonly timeoutMs = 2000,
  ) {}

  async execute(): Promise<Result<HealthOutput, never>> {
    const statuses = await Promise.all(
      this.indicators.map(async (indicator): Promise<[string, DependencyStatus]> => [
        indicator.name,
        await this.probe(indicator),
      ]),
    );
    const checks = Object.fromEntries(statuses);
    return ok({
      status: statuses.every(([, status]) => status === 'up') ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(this.performanceMonitor.nowMs() / 1000),
      checks,
    });
  }

  private async probe(indicator: HealthIndicator): Promise<DependencyStatus> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${indicator.name} health check timed out`));
      }, this.timeoutMs);
    });
    try {
      await Promise.race([indicator.check(), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
