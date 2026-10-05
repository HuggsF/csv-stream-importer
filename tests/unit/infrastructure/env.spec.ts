import { ConfigValidationError, loadConfig } from '@infrastructure/config/env';

const REQUIRED = {
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_USER: 'root',
  DB_PASSWORD: 'secret',
  DB_NAME: 'csv_importer',
};

describe('loadConfig', () => {
  it('applies defaults to optional variables', () => {
    const config = loadConfig(REQUIRED);

    expect(config).toEqual({
      env: 'development',
      http: { port: 3000 },
      log: { level: 'info', pretty: false },
      database: {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'secret',
        name: 'csv_importer',
        pool: { min: 2, max: 10 },
        migrateOnStart: false,
      },
      import: {
        batchSize: 1000,
        csvMaxRowBytes: 65_536,
        errorReportDir: './output',
        uploadDir: './uploads',
        uploadMaxBytes: 209_715_200,
        queueConcurrency: 1,
        queueMaxPending: 10,
      },
      shutdownTimeoutMs: 30_000,
    });
  });

  it('coerces numbers and boolean flags', () => {
    const config = loadConfig({
      ...REQUIRED,
      PORT: '8080',
      LOG_PRETTY: 'true',
      DB_MIGRATE_ON_START: '1',
      IMPORT_BATCH_SIZE: '500',
      DB_PASSWORD: '',
    });

    expect(config.http.port).toBe(8080);
    expect(config.log.pretty).toBe(true);
    expect(config.database.migrateOnStart).toBe(true);
    expect(config.import.batchSize).toBe(500);
    expect(config.database.password).toBe('');
  });

  it('lists every invalid variable', () => {
    const load = (): unknown =>
      loadConfig({ DB_PORT: 'abc', IMPORT_BATCH_SIZE: '0', LOG_LEVEL: 'loud' });

    expect(load).toThrow(ConfigValidationError);
    try {
      load();
    } catch (error: unknown) {
      const { issues } = error as ConfigValidationError;
      expect(issues.map((issue) => issue.split(':')[0])).toEqual(
        expect.arrayContaining([
          'LOG_LEVEL',
          'DB_HOST',
          'DB_PORT',
          'DB_USER',
          'DB_PASSWORD',
          'DB_NAME',
          'IMPORT_BATCH_SIZE',
        ]),
      );
    }
  });

  it('rejects a pool whose minimum exceeds its maximum', () => {
    expect(() => loadConfig({ ...REQUIRED, DB_POOL_MIN: '20', DB_POOL_MAX: '5' })).toThrow(
      'DB_POOL_MIN must be less than or equal to DB_POOL_MAX',
    );
  });
});
