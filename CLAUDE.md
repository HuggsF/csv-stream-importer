# CLAUDE.md — csv-stream-importer

## Project Context
This project demonstrates processing a 500,000-line CSV import in Node.js using Streams with backpressure, validating data through DDD Value Objects, and performing bulk inserts into MySQL — all without blocking the Event Loop or causing OOM.

## Key Constraints
- MUST use `fs.createReadStream` — never `readFileSync`
- MUST use `for await...of` for backpressure
- MUST batch inserts (default 1000 rows per INSERT)
- MUST validate through Value Objects (Email, Score, StudentName)
- MUST produce an error report CSV for invalid rows
- Memory usage MUST stay under 100MB even with 500k rows

## Implementation Order
1. Domain: entities (Student), value objects (Email, Score, StudentName), errors
2. Domain: repository interface (StudentRepository)
3. Application: ImportStudentsUseCase with Result pattern
4. Application: CsvStreamReader interface
5. Infrastructure: MySQL repository implementation (bulk insert with knex)
6. Infrastructure: CSV stream reader implementation
7. Infrastructure: Config with zod, Logger with pino
8. Presentation: CLI with commander
9. Scripts: CSV generator with faker
10. Benchmarks: sync vs stream comparison
11. Tests: unit -> integration -> e2e
12. Docker Compose + Dockerfile

## Project-Specific Dependencies
- mysql2, knex, csv-parser, commander, uuid
- @faker-js/faker (dev)

## Database Schema
```sql
CREATE TABLE students (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  enrollment_date DATE NOT NULL,
  course_id VARCHAR(36) NOT NULL,
  score DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_course (course_id)
);
```
