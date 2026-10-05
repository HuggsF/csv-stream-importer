# ADR-003 — Result pattern instead of exceptions for expected failures

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

An import has many *expected* failures: 5 % of the rows are invalid, the file may not exist, the
batch size may be out of range, a job may not be found. If these were exceptions:

- every caller would need `try/catch`, and TypeScript cannot tell which errors a function throws
  (`catch (error: unknown)`);
- control flow for a perfectly normal situation (an invalid email) would rely on stack unwinding,
  which is also slow: creating 25,000 exceptions per import is measurable;
- it would be easy to forget a case and turn a validation error into an HTTP 500.

## Decision

Factories and use cases return a discriminated union (`src/domain/shared/result.ts`):

```ts
type Result<T, E> = { success: true; data: T } | { success: false; error: E };
```

- **Value Objects / Entities**: `Email.create(raw): Result<Email, InvalidEmailError>`.
  `Student.create()` collects **all** field violations of a row into one `InvalidStudentError`, so
  the error report lists every problem of a line at once.
- **Use cases never throw**: `ImportStudentsUseCase.execute()` returns
  `Result<ImportStudentsOutput, InvalidImportOptionsError | InvalidFilePathError | ImportFailedError>`.
  Unexpected infrastructure exceptions (database down, disk error) are caught at the use case
  boundary and wrapped (`ImportFailedError` carries the progress made before the failure).
- **Errors are typed classes** with a stable `code` (`INVALID_EMAIL`, `IMPORT_JOB_NOT_FOUND`…):
  `DomainError` for business rules, `ApplicationError` for use-case level failures.
- **Presentation maps errors once**: the HTTP layer translates `error.code` into a status
  (`error-mapper.ts`), the CLI into an exit code.

Exceptions remain for programming errors and for infrastructure adapters (they are converted at
the use-case boundary) and for startup failures such as invalid configuration.

## Consequences

- ✅ The compiler forces callers to handle failures (`if (!result.success) …`), and the error union
  documents exactly what can go wrong.
- ✅ Validating 500,000 rows involves no `try/catch` in the hot path.
- ✅ Tests assert on returned values instead of `toThrow`.
- ⚠️ Slightly more verbose call sites; propagating a failure means `return result;`.
- ⚠️ Domain error objects still extend `Error` (stack traces are useful when logged); creating
  them has a cost, but it is paid only for invalid rows.

## Alternatives considered

- **Exceptions everywhere** — rejected for the reasons above.
- **A library (`neverthrow`, `fp-ts`)** — powerful, but a 10-line type is enough here and keeps the
  Domain free of external dependencies (Clean Architecture dependency rule).
