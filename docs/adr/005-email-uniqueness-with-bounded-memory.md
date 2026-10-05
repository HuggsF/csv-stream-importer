# ADR-005 — Email uniqueness with O(batch) memory

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

`students.email` is `UNIQUE`. A CSV can contain the same email twice (in the same batch or
thousands of lines apart), and an email may already exist from a previous import.

If a multi-row `INSERT` hits a duplicate key, MySQL rejects the **whole statement**: one
duplicate would drop 999 valid rows. We also want every duplicate reported with its line number.

The obvious fix — a `Set` of every email seen so far — costs ~80 bytes per email: ~40 MB for
500,000 rows, i.e. memory that grows with the file, which contradicts ADR-001/004.

## Decision

Enforce uniqueness per batch, letting the database remember what previous batches inserted:

1. Before inserting a batch, `findExistingEmails(batchEmails)` runs one indexed query
   (`SELECT email FROM students WHERE email IN (…1,000 values…)`).
2. The domain service `StudentUniquenessService` partitions the batch: emails already registered
   and later occurrences of an email inside the batch become `DuplicateStudentError`s (first
   occurrence wins), the rest is inserted.
3. Batches are processed sequentially and each one is committed before the next lookup, so a
   duplicate thousands of lines later is caught by step 1.
4. The INSERT uses `INSERT IGNORE` as a safety net for the only remaining case — another process
   inserting the same email between our lookup and our INSERT. `affectedRows` tells exactly how
   many rows were written; the difference is counted as rejected rows and logged.

## Consequences

- ✅ Memory stays O(batch size) whatever the file size.
- ✅ Every duplicate is reported with its line number and a precise reason
  (*already registered* vs *appears more than once in the file*).
- ✅ Imports are idempotent: re-importing a file inserts nothing and reports every row as a
  duplicate (verified by the e2e suite).
- ⚠️ One extra indexed query per batch (~500 for 500,000 rows) — cheap next to the INSERT.
- ⚠️ `INSERT IGNORE` also downgrades other errors (e.g. truncation) to warnings. This is safe here
  because every value has been validated by the Domain (lengths, formats, ranges) before reaching
  the repository.
- ⚠️ Rows skipped by the safety net (concurrent imports) are counted but not individually listed in
  the error report.

## Alternatives considered

- **Global `Set` of emails** — O(file) memory (see above).
- **`ON DUPLICATE KEY UPDATE id = id`** — with mysql2's default `CLIENT_FOUND_ROWS` flag
  duplicates are reported as affected rows, so inserted rows cannot be counted.
- **Insert row by row on batch failure** — correct but turns a single duplicate into 1,000
  statements.
- **Staging table + `INSERT … SELECT`** — great for very large loads, but more moving parts than
  this problem needs.
