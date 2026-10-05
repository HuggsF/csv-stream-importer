# ADR-001 — Stream the CSV instead of `readFileSync`

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

We must import a 500,000-row CSV (~48 MB) of students into MySQL from a Node.js process that also
serves HTTP traffic (health checks, upload API). Node.js runs JavaScript on a single thread: any
long synchronous operation freezes **every** request handled by the process.

The naive implementation reads the whole file, splits it into lines, maps every line to an object
and validates it:

```ts
const rows = readFileSync(path, 'utf8').split('\n').map(parse); // whole file + all objects in RAM
rows.forEach(validateAndCollect);                                // one long synchronous block
```

Two problems:

1. **Memory grows linearly with the file**: the raw string, the array of lines and the array of
   objects coexist in the heap. A 5 GB export would crash the process (OOM), and even 48 MB of CSV
   becomes ~440 MB of heap once parsed into objects.
2. **The Event Loop is blocked for the whole parse**: no HTTP response, no timer, no health check
   for seconds — an orchestrator can kill the container as unhealthy.

## Decision

Read the file with `fs.createReadStream` piped into `csv-parser`, and consume rows with
`for await...of` (see `CsvParserStreamReader` and `ImportStudentsUseCase`):

```
createReadStream (64 KB chunks) → csv-parser (Transform, objectMode) → for await (row) → batch[1000] → bulk INSERT
```

- `for await...of` gives **backpressure for free**: while the loop body awaits the bulk INSERT, it
  stops pulling rows; the parser's buffer fills up (`highWaterMark`), `pipeline` stops writing to
  it, and the file stream stops reading from disk.
- Parsing happens chunk by chunk, so the Event Loop gets control back between chunks.
- `pipeline()` propagates errors from any stage, and the reader destroys both streams in a
  `finally` block when the consumer stops early (abort, error), releasing the file handle.
- The reader is an Application port (`CsvStreamReader`), so the use case is tested with an
  in-memory async iterable and the streaming adapter is tested against real files.

## Evidence

`npm run benchmark` (500,000 rows, 48.4 MB, each strategy in a fresh process —
full report in [`benchmarks/results.md`](../../benchmarks/results.md)):

| Metric | `readFileSync` | `createReadStream` |
|---|---:|---:|
| Peak heap used | 438.9 MB | 63.9 MB |
| Peak RSS | 590.9 MB | 177.6 MB |
| Longest Event Loop block | **3.59 s** | **54 ms** |
| With a 64 MB heap cap | 💥 heap out of memory | ✅ 71.1 MB RSS |

## Consequences

- ✅ Memory is bounded by `chunk size + batch size`, independent of the file size.
- ✅ The process stays responsive during imports (HTTP API and `/health` keep answering).
- ✅ Imports can be aborted cleanly (SIGINT / shutdown): the loop stops, the current batch is
  flushed, the stream is destroyed.
- ⚠️ Raw parsing is ~1.5× slower than a tight synchronous loop (per-row `await`). Irrelevant in
  practice: the database round-trips dominate the real import time (see ADR-002).
- ⚠️ `line_number` in the error report assumes one record per physical line; a quoted field
  containing a newline shifts the following line numbers. Acceptable for this data set.

## Alternatives considered

- **`readline` over a read stream** — streams lines but does not handle quoted fields with commas
  or newlines; we would re-implement a CSV parser.
- **Worker threads with `readFileSync`** — keeps the main loop free, but still loads the whole
  file in memory (only moves the OOM to another thread).
- **`papaparse` streaming mode** — equivalent; `csv-parser` is smaller and a native Transform
  stream that composes with `pipeline()`.
