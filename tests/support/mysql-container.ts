import { MySqlContainer } from '@testcontainers/mysql';
import type { StartedMySqlContainer } from '@testcontainers/mysql';
import type { Knex } from 'knex';
import type { DatabaseConfig } from '@infrastructure/config/env';
import { createDatabase } from '@infrastructure/database/knex';
import { migrateLatest } from '@infrastructure/database/migrator';

export const CONTAINER_STARTUP_TIMEOUT_MS = 180_000;

export type TestDatabase = {
  readonly container: StartedMySqlContainer;
  readonly config: DatabaseConfig;
  readonly db: Knex;
  readonly stop: () => Promise<void>;
};

/** Starts a throw-away MySQL 8 (same image as docker-compose) and applies the migrations. */
export const startTestDatabase = async (): Promise<TestDatabase> => {
  const container = await new MySqlContainer('mysql:8')
    .withDatabase('csv_importer')
    .withUsername('importer')
    .withUserPassword('importer')
    .start();

  const config: DatabaseConfig = {
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getUserPassword(),
    name: container.getDatabase(),
    pool: { min: 0, max: 5 },
    migrateOnStart: false,
  };
  const db = createDatabase(config);
  await migrateLatest(db);

  return {
    container,
    config,
    db,
    stop: async (): Promise<void> => {
      await db.destroy();
      await container.stop();
    },
  };
};
