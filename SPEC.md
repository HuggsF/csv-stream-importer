# SPEC.md — csv-stream-importer

## Overview

| Field | Value |
|---|---|
| **Project** | csv-stream-importer |
| **Problem** | Process 500k-line CSV import without blocking Event Loop or causing OOM |
| **Interview Question** | Q7 — DOT Digital Group Senior Backend Node.js |
| **Architecture** | Clean Architecture + DDD + TypeScript |

## Problem Statement

A Node.js application needs to import a CSV file with 500,000 student records, validate each row, and bulk-insert valid records into MySQL — all without:
1. Blocking the Event Loop (no synchronous I/O)
2. Running out of memory (no loading entire file into RAM)
3. Overwhelming the database (no individual INSERTs per row)

## Solution

Use Node.js Streams (`fs.createReadStream`) with backpressure to process data on-demand, validate each row through domain value objects, accumulate validated records into batches of 1,000, and perform bulk INSERTs.

---

## Domain Model

### Entities

#### Student
```typescript
// src/domain/entities/student.entity.ts
class Student {
  private constructor(
    readonly id: string,
    readonly name: StudentName,
    readonly email: Email,
    readonly enrollmentDate: Date,
    readonly courseId: string,
    readonly score: Score
  ) {}
  
  static create(props: StudentProps): Result<Student, DomainError>
}
```

### Value Objects

#### Email
- Must be valid email format
- Lowercase normalized
- Max 255 characters

#### StudentName
- Min 2 characters, max 100
- No special characters except spaces, hyphens, apostrophes

#### Score
- Number between 0 and 100
- Two decimal places max

#### FilePath
- Must end with `.csv`
- Must be accessible (readable)

### Domain Errors
- `InvalidEmailError`
- `InvalidStudentNameError`
- `InvalidScoreError`
- `InvalidFilePathError`
- `DuplicateStudentError`

### Repository Interfaces (Ports)

```typescript
// src/domain/repositories/student.repository.ts
interface StudentRepository {
  bulkInsert(students: Student[]): Promise<number>;
  findByEmail(email: string): Promise<Student | null>;
  count(): Promise<number>;
}
```

---

## Application Layer

### Use Cases

#### ImportStudentsUseCase
```typescript
// src/application/use-cases/import-students.use-case.ts
class ImportStudentsUseCase {
  constructor(
    private readonly studentRepository: StudentRepository,
    private readonly csvReader: CsvStreamReader,
    private readonly logger: Logger
  ) {}

  async execute(input: ImportStudentsInput): Promise<ImportStudentsOutput>
}
```

**Input DTO:**
```typescript
type ImportStudentsInput = {
  filePath: string;
  batchSize?: number;  // default: 1000
}
```

**Output DTO:**
```typescript
type ImportStudentsOutput = {
  totalProcessed: number;
  totalImported: number;
  totalErrors: number;
  errors: ValidationError[];
  durationMs: number;
  peakMemoryMB: number;
}
```

### Application Interfaces (Ports)

```typescript
// src/application/interfaces/csv-stream-reader.ts
interface CsvStreamReader {
  read(filePath: string): AsyncIterable<RawStudentRow>;
}
```

---

## Infrastructure Layer

### Database
- **MySQL 8** via `mysql2` (promise API)
- **Knex.js** for migrations and query building
- Bulk insert using `INSERT INTO students (...) VALUES (...), (...), ...`
- Connection pooling (min: 2, max: 10)

### CSV Stream Reader
- `fs.createReadStream` + `csv-parser` library
- Implements `CsvStreamReader` interface
- Uses `for await...of` for automatic backpressure

### Config
- `zod` schema for environment variables
- Required: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

### Logging
- `pino` with structured JSON output
- Log levels: info for progress, warn for skipped rows, error for failures

---

## Presentation Layer

### CLI Interface
```bash
# Import a CSV file
npm run import -- --file ./data/students.csv --batch-size 1000

# Generate fake CSV for testing
npm run generate -- --rows 500000 --output ./data/students.csv
```

### HTTP Interface (optional bonus)
```
POST /api/import
  Body: multipart/form-data with CSV file
  Response: { jobId: string }

GET /api/import/:jobId/status
  Response: ImportStudentsOutput
```

---

## Technical Requirements

### Benchmark
Include a `benchmarks/` directory with:
1. **sync-vs-stream.ts** — Compares `readFileSync` vs `createReadStream`:
   - Memory usage (RSS, heapUsed)
   - Time to process
   - Event loop lag
2. Results should be printed as a table and saved to `benchmarks/results.md`

### Data Generator
`scripts/generate-csv.ts` using `@faker-js/faker`:
- Generates configurable number of rows (default: 500,000)
- ~5% of rows should have intentional validation errors
- Fields: name, email, enrollment_date, course_id, score

### Error Report
- Invalid rows saved to `output/errors-{timestamp}.csv`
- Columns: line_number, field, value, error_message

---

## Tests

### Unit Tests
- `student.entity.spec.ts` — Entity creation, validation
- `email.value-object.spec.ts` — Email validation
- `score.value-object.spec.ts` — Score boundaries
- `import-students.use-case.spec.ts` — Happy path, partial failures, empty file

### Integration Tests
- `mysql-student.repository.test.ts` — Bulk insert, count (with testcontainers)
- `csv-stream-reader.test.ts` — Read small fixture CSV

### E2E Tests
- `import-pipeline.e2e.test.ts` — Full flow: CSV -> validate -> MySQL

---

## Docker Compose

```yaml
services:
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: csv_importer
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: mysqladmin ping -h localhost
      interval: 5s
      retries: 10

  app:
    build:
      context: .
      dockerfile: docker/Dockerfile.dev
    volumes:
      - .:/app
      - /app/node_modules
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_USER=root
      - DB_PASSWORD=root
      - DB_NAME=csv_importer

volumes:
  mysql_data:
```

---

## Dependencies

### Production
- mysql2, knex, csv-parser, pino, zod, dotenv, uuid, commander

### Development
- typescript, tsx, jest, ts-jest, @faker-js/faker, @types/node, eslint, prettier, testcontainers

---

## ADR Documents to Create

1. `docs/adr/001-streams-over-readfile.md` — Why Streams instead of readFileSync
2. `docs/adr/002-bulk-insert-batch-size.md` — Why 1000 as default batch size
3. `docs/adr/003-result-pattern.md` — Why Result pattern instead of exceptions
