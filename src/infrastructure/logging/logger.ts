import { pino } from 'pino';
import type { Logger as PinoLogger } from 'pino';

export type LoggerOptions = {
  readonly level: string;
  readonly pretty: boolean;
  readonly name?: string;
};

export type AppLogger = PinoLogger;

/**
 * Structured JSON logger. `LOG_PRETTY=true` switches to human-readable output for local
 * development (requires the `pino-pretty` dev dependency).
 */
export const createLogger = (options: LoggerOptions): AppLogger =>
  pino({
    name: options.name ?? 'csv-stream-importer',
    level: options.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: ['password', '*.password', 'config.database.password', 'req.headers.authorization'],
      censor: '[REDACTED]',
    },
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
