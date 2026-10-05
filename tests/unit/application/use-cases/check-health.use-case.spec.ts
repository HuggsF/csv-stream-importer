import { CheckHealthUseCase } from '@application/use-cases/check-health.use-case';

const clock = { nowMs: (): number => 12_400 };

describe('CheckHealthUseCase', () => {
  it('reports ok when every dependency is up', async () => {
    const useCase = new CheckHealthUseCase(
      [{ name: 'database', check: () => Promise.resolve() }],
      clock,
    );

    const result = await useCase.execute();

    expect(result).toEqual({
      success: true,
      data: { status: 'ok', uptimeSeconds: 12, checks: { database: 'up' } },
    });
  });

  it('reports degraded when a dependency fails', async () => {
    const useCase = new CheckHealthUseCase(
      [
        { name: 'database', check: () => Promise.reject(new Error('ECONNREFUSED')) },
        { name: 'disk', check: () => Promise.resolve() },
      ],
      clock,
    );

    const result = await useCase.execute();

    expect(result.success && result.data).toMatchObject({
      status: 'degraded',
      checks: { database: 'down', disk: 'up' },
    });
  });

  it('marks a dependency as down when its check exceeds the timeout', async () => {
    const useCase = new CheckHealthUseCase(
      [{ name: 'database', check: () => new Promise<void>(() => undefined) }],
      clock,
      20,
    );

    const result = await useCase.execute();

    expect(result.success && result.data.checks).toEqual({ database: 'down' });
  });
});
