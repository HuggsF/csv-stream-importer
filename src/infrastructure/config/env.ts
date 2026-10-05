import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const port = z.coerce.number().int().min(1).max(65_535);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: port.default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFlag.default('false'),

    DB_HOST: z.string().min(1),
    DB_PORT: port,
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string(),
    DB_NAME: z.string().min(1),
    DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
    DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DB_MIGRATE_ON_START: booleanFlag.default('false'),

    IMPORT_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(1000),
    CSV_MAX_ROW_BYTES: z.coerce
      .number()
      .int()
      .min(256)
      .default(64 * 1024),
    ERROR_REPORT_DIR: z.string().min(1).default('./output'),
    UPLOAD_DIR: z.string().min(1).default('./uploads'),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(200 * 1024 * 1024),
    IMPORT_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
    IMPORT_QUEUE_MAX_PENDING: z.coerce.number().int().min(0).default(10),

    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  })
  .refine((env) => env.DB_POOL_MIN <= env.DB_POOL_MAX, {
    message: 'DB_POOL_MIN must be less than or equal to DB_POOL_MAX',
    path: ['DB_POOL_MIN'],
  });

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

export type DatabaseConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly name: string;
  readonly pool: { readonly min: number; readonly max: number };
  readonly migrateOnStart: boolean;
};

export type AppConfig = {
  readonly env: 'development' | 'test' | 'production';
  readonly http: { readonly port: number };
  readonly log: { readonly level: LogLevel; readonly pretty: boolean };
  readonly database: DatabaseConfig;
  readonly import: {
    readonly batchSize: number;
    readonly csvMaxRowBytes: number;
    readonly errorReportDir: string;
    readonly uploadDir: string;
    readonly uploadMaxBytes: number;
    readonly queueConcurrency: number;
    readonly queueMaxPending: number;
  };
  readonly shutdownTimeoutMs: number;
};

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

/** Loads `.env` (if present) into process.env without overriding variables already set. */
export const loadEnvFile = (path?: string): void => {
  loadDotenv({ path, quiet: true });
};

/** Validates the environment once at startup: the app refuses to boot with a bad configuration. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const vars = parsed.data;

  return {
    env: vars.NODE_ENV,
    http: { port: vars.PORT },
    log: { level: vars.LOG_LEVEL, pretty: vars.LOG_PRETTY },
    database: {
      host: vars.DB_HOST,
      port: vars.DB_PORT,
      user: vars.DB_USER,
      password: vars.DB_PASSWORD,
      name: vars.DB_NAME,
      pool: { min: vars.DB_POOL_MIN, max: vars.DB_POOL_MAX },
      migrateOnStart: vars.DB_MIGRATE_ON_START,
    },
    import: {
      batchSize: vars.IMPORT_BATCH_SIZE,
      csvMaxRowBytes: vars.CSV_MAX_ROW_BYTES,
      errorReportDir: vars.ERROR_REPORT_DIR,
      uploadDir: vars.UPLOAD_DIR,
      uploadMaxBytes: vars.UPLOAD_MAX_BYTES,
      queueConcurrency: vars.IMPORT_QUEUE_CONCURRENCY,
      queueMaxPending: vars.IMPORT_QUEUE_MAX_PENDING,
    },
    shutdownTimeoutMs: vars.SHUTDOWN_TIMEOUT_MS,
  };
};
