import type { Knex } from 'knex';

export const name = '20260101000000_create_students_table';

export const up = async (knex: Knex): Promise<void> => {
  await knex.schema.createTable('students', (table) => {
    table.string('id', 36).primary();
    table.string('name', 100).notNullable();
    // The UNIQUE constraint already creates a B-tree index, so it is named `idx_email`
    // instead of adding a second, redundant index on the same column (slower inserts).
    table.string('email', 255).notNullable().unique({ indexName: 'idx_email' });
    table.date('enrollment_date').notNullable();
    table.string('course_id', 36).notNullable();
    table.decimal('score', 5, 2).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index(['course_id'], 'idx_course');
  });
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.schema.dropTableIfExists('students');
};
