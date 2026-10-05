# ADR-002 — Bulk INSERT in batches of 1,000 rows by default

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Valid rows must reach MySQL as fast as possible without overwhelming it. Inserting one row per
statement means 500,000 network round-trips and 500,000 transactions (one `fsync` each with
`autocommit`). Inserting everything at once means holding every row in memory (defeats ADR-001)
and building a single gigantic statement (bounded by `max_allowed_packet` and by the 65,535
placeholders limit of prepared statements).

## Decision

- Accumulate validated students in a batch and flush it with **one multi-row statement**:
  `INSERT IGNORE INTO students (id, name, email, enrollment_date, course_id, score) VALUES (…), (…), …`
- Default batch size **1,000**, configurable per run (`--batch-size`, `?batchSize=`) or globally
  (`IMPORT_BATCH_SIZE`), validated to `1..10,000` (6 placeholders × 10,000 = 60,000 < 65,535).
- Primary keys are **UUID v7** (time-ordered, RFC 9562): consecutive inserts land at the end of the
  InnoDB clustered index instead of splitting random pages as UUID v4 would.

## Evidence

Measured with the real pipeline (CSV → validation → MySQL 8 in Docker on a laptop,
120,000 rows; the row-by-row case was measured on 10,000 rows):

| Batch size | Rows/s | Peak RSS | Statements for 500k rows |
|---:|---:|---:|---:|
| 1 (row by row, 10k rows) | 126 | 71.5 MB | ~1,000,000 |
| 100 | 6,659 | 74.6 MB | ~10,000 |
| **1,000 (default)** | **8,587** | **75.9 MB** | **~1,000** |
| 5,000 | 15,335 | 78.6 MB | ~200 |
| 10,000 | 16,396 | 100.4 MB | ~100 |

(Each batch is two statements: the duplicate lookup of ADR-005 and the INSERT.)

## Why 1,000 and not 5,000?

Going from 1 to 1,000 removes **99.9 % of the round-trips** (68× faster). Beyond that the gains
are real on this setup (5,000 is 1.8× faster) but come with costs that depend on the environment:

- **Blast radius**: a failed statement (deadlock, timeout, connection reset) loses a bigger batch;
  smaller batches mean cheaper retries and finer-grained progress.
- **Lock and replication footprint**: bigger transactions hold row locks longer and produce larger
  binlog events, which hurts replicas and concurrent writers on a shared production database.
- **Memory**: every in-flight row is held twice (domain objects + SQL string); 10,000 already
  pushes the importer to 100 MB.
- **Specification**: the default is part of the project specification.

1,000 is therefore a conservative, portable default; operators who own the database can raise
`IMPORT_BATCH_SIZE` (5,000 is a good value for a dedicated MySQL).

## Consequences

- ✅ ~500 INSERTs instead of 500,000 for the reference file; 8.5k rows/s end to end.
- ✅ Memory stays flat: only one batch lives in memory at a time.
- ⚠️ Rows of a batch are committed together: if the process dies, the last batch in flight is lost
  and must be re-imported. Re-importing is safe because duplicates are detected (ADR-005).

## Possible improvements

- Overlap I/O: parse/validate batch *n+1* while batch *n* is being inserted (one in-flight batch);
  the database round-trip currently pauses the parser.
- `LOAD DATA LOCAL INFILE` of a cleaned temporary file — fastest MySQL ingestion path, but it
  bypasses per-row domain validation and requires `local_infile` on the server.
