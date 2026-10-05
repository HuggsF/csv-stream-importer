import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import type { Faker } from '@faker-js/faker' with { 'resolution-mode': 'import' };

/** Faker v10 is ESM-only: loaded with a dynamic import from this CommonJS project. */
const loadFaker = async (): Promise<Faker> => (await import('@faker-js/faker')).faker;

export type GenerateCsvOptions = {
  readonly rows: number;
  readonly output: string;
  /** Share of rows (0..1) that are intentionally invalid. */
  readonly errorRate: number;
  readonly seed: number;
};

export type GenerateCsvResult = {
  readonly rows: number;
  readonly invalidRows: number;
  readonly durationMs: number;
};

export const CSV_HEADER = 'name,email,enrollment_date,course_id,score';

const EMAIL_DOMAINS = ['school.edu', 'university.edu.br', 'campus.org', 'mail.com', 'learn.io'];
const COURSE_COUNT = 50;
const RECENT_EMAILS = 1000;

type Row = [name: string, email: string, enrollmentDate: string, courseId: string, score: string];

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const escapeCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** One corruption per invalid row, covering every validation rule of the Domain. */
const CORRUPTIONS: readonly ((row: Row, faker: Faker, recentEmails: readonly string[]) => Row)[] = [
  ([name, email, date, course]) => [name, email.replace('@', '.at.'), date, course, '75.00'],
  ([name, , date, course, score]) => [name, '', date, course, score],
  ([name, email, date, course]) => [name, email, date, course, '104.50'],
  ([name, email, date, course]) => [name, email, date, course, '-3'],
  ([name, email, date, course]) => [name, email, date, course, '85.555'],
  ([name, email, date, course]) => [name, email, date, course, 'N/A'],
  ([, email, date, course, score]) => ['J0hn Sm1th', email, date, course, score],
  ([, email, date, course, score]) => ['A', email, date, course, score],
  ([name, email, , course, score]) => [name, email, '2024-13-45', course, score],
  ([name, email, , course, score]) => [name, email, '15/03/2024', course, score],
  ([name, email, date, , score]) => [name, email, date, '', score],
  ([name, , date, course, score], faker, recentEmails) => [
    name,
    recentEmails.length > 0 ? faker.helpers.arrayElement(recentEmails) : 'dup@school.edu',
    date,
    course,
    score,
  ],
];

const validRow = (faker: Faker, index: number, courseIds: readonly string[]): Row => {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const domain = faker.helpers.arrayElement(EMAIL_DOMAINS);
  return [
    `${firstName} ${lastName}`,
    // The row index keeps emails unique; duplicates only appear when injected on purpose.
    `${slug(firstName)}.${slug(lastName)}.${index}@${domain}`,
    faker.date.between({ from: '2019-01-01', to: '2026-06-30' }).toISOString().slice(0, 10),
    faker.helpers.arrayElement(courseIds),
    faker.number.float({ min: 0, max: 100, fractionDigits: 2 }).toFixed(2),
  ];
};

/**
 * Writes a fake students CSV with constant memory: rows are generated and streamed one by
 * one, waiting for 'drain' whenever the write buffer is full.
 */
export const generateStudentsCsv = async (
  options: GenerateCsvOptions,
): Promise<GenerateCsvResult> => {
  const startedAt = performance.now();
  const faker = await loadFaker();
  faker.seed(options.seed);
  const courseIds = Array.from({ length: COURSE_COUNT }, () => faker.string.uuid());
  const recentEmails: string[] = [];

  await mkdir(dirname(options.output), { recursive: true });
  const stream = createWriteStream(options.output, { encoding: 'utf8' });
  const write = async (line: string): Promise<void> => {
    if (!stream.write(`${line}\n`)) {
      await once(stream, 'drain');
    }
  };

  let invalidRows = 0;
  await write(CSV_HEADER);
  for (let index = 0; index < options.rows; index += 1) {
    let row = validRow(faker, index, courseIds);
    if (faker.number.float({ min: 0, max: 1 }) < options.errorRate) {
      row = faker.helpers.arrayElement(CORRUPTIONS)(row, faker, recentEmails);
      invalidRows += 1;
    } else {
      recentEmails[index % RECENT_EMAILS] = row[1];
    }
    await write(row.map(escapeCell).join(','));
  }
  stream.end();
  await finished(stream);

  return {
    rows: options.rows,
    invalidRows,
    durationMs: Math.round(performance.now() - startedAt),
  };
};
