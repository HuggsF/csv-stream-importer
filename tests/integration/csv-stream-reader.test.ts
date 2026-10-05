import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawStudentRow } from '@application/interfaces/csv-stream-reader';
import {
  CsvParserStreamReader,
  InvalidCsvHeaderError,
} from '@infrastructure/csv/csv-parser-stream-reader';

const FIXTURES = join(__dirname, '..', 'fixtures');

const readAll = async (reader: CsvParserStreamReader, file: string): Promise<RawStudentRow[]> => {
  const rows: RawStudentRow[] = [];
  for await (const row of reader.read(file)) {
    rows.push(row);
  }
  return rows;
};

describe('CsvParserStreamReader (real files)', () => {
  const reader = new CsvParserStreamReader({ maxRowBytes: 64 * 1024 });
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'csv-reader-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('reads the fixture: BOM, CRLF, case/space-insensitive headers, quotes, blank lines', async () => {
    const rows = await readAll(reader, join(FIXTURES, 'students-small.csv'));

    expect(rows).toEqual([
      {
        lineNumber: 2,
        name: 'Ana Souza',
        email: 'ana@school.edu',
        enrollmentDate: '2024-01-15',
        courseId: 'COURSE-1',
        score: '90.5',
      },
      {
        lineNumber: 3,
        name: 'Silva, Maria',
        email: 'maria@school.edu',
        enrollmentDate: '2024-02-01',
        courseId: 'COURSE-2',
        score: '78',
      },
      {
        lineNumber: 5,
        name: 'J0hn',
        email: 'john@school',
        enrollmentDate: '2024-13-01',
        courseId: '',
        score: '150',
      },
      {
        lineNumber: 6,
        name: 'Pedro Alves',
        email: 'ana@school.edu',
        enrollmentDate: '2023-05-10',
        courseId: 'COURSE-1',
        score: '60',
      },
      {
        lineNumber: 7,
        name: 'Short Row',
        email: 'short@school.edu',
        enrollmentDate: undefined,
        courseId: undefined,
        score: undefined,
      },
    ]);
  });

  it('fails fast when required columns are missing', async () => {
    await expect(readAll(reader, join(FIXTURES, 'wrong-header.csv'))).rejects.toThrow(
      new InvalidCsvHeaderError(['name', 'enrollment_date', 'course_id']),
    );
  });

  it('yields nothing for an empty file', async () => {
    const empty = join(workDir, 'empty.csv');
    await writeFile(empty, '');

    expect(await readAll(reader, empty)).toEqual([]);
  });

  it('rejects a row larger than maxRowBytes instead of buffering it', async () => {
    const huge = join(workDir, 'huge.csv');
    await writeFile(
      huge,
      `name,email,enrollment_date,course_id,score\n${'x'.repeat(2048)},a@b.co,2024-01-01,C1,1\n`,
    );

    await expect(readAll(new CsvParserStreamReader({ maxRowBytes: 1024 }), huge)).rejects.toThrow(
      'Row exceeds the maximum size',
    );
  });

  it('surfaces file system errors through the iterator', async () => {
    await expect(readAll(reader, join(workDir, 'missing.csv'))).rejects.toThrow(/ENOENT/);
  });

  it('streams a large file lazily and releases it when the consumer stops early', async () => {
    const large = join(workDir, 'large.csv');
    const lines = Array.from(
      { length: 50_000 },
      (_, index) => `Student Name,s${index}@school.edu,2024-01-01,C1,50`,
    );
    await writeFile(large, `name,email,enrollment_date,course_id,score\n${lines.join('\n')}\n`);

    let consumed = 0;
    for await (const row of reader.read(large)) {
      consumed += 1;
      if (row.lineNumber === 11) {
        break;
      }
    }

    expect(consumed).toBe(10);
    // The file handle was released: on Windows an open handle would make rm fail with EBUSY.
    await expect(rm(large)).resolves.toBeUndefined();
  });
});
