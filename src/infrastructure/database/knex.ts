import { knex } from 'knex';
import type { Knex } from 'knex';
import type { DatabaseConfig } from '@infrastructure/config/env';

/** MySQL connection pool (mysql2 driver). */
export const createDatabase = (config: DatabaseConfig): Knex =>
  knex({
    client: 'mysql2',
    connection: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.name,
      charset: 'utf8mb4',
      timezone: 'Z',
      // DATE columns come back as 'YYYY-MM-DD' strings: no time-zone shift on calendar dates.
      dateStrings: true,
      decimalNumbers: true,
    },
    pool: { min: config.pool.min, max: config.pool.max },
  });

export const pingDatabase = async (db: Knex): Promise<void> => {
  await db.raw('SELECT 1');
};
