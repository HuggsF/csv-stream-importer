# Benchmark — `readFileSync` vs `createReadStream`

- **File:** `./data/students.csv` — 500,000 rows, 48.4 MB
- **Environment:** Node v24.19.0 · win32 x64 · 13th Gen Intel(R) Core(TM) i5-13450HX · 16 GB RAM
- **Date:** 2026-10-05
- **Workload:** parse + validate every row through the Domain (`Student.create`), batches of 1,000 handed to a simulated async insert (no database, to isolate the I/O strategy). Each run is a fresh process.

## Default Node.js heap settings

| Metric | `readFileSync` | `createReadStream` | Sync / Stream |
|---|---:|---:|---:|
| Rows processed | 500,000 | 500,000 |  |
| Peak memory (RSS) | 590.9 MB | 177.6 MB | 3.3× |
| Peak heap used | 438.9 MB | 63.9 MB | 6.9× |
| Total time | 3.59s | 5.66s |  |
| Longest event loop block | 3.59s | 54ms | 66.4× |
| p99 event loop delay | 3.59s | 31ms |  |
| Valid / invalid rows | 477123 / 22877 | 477123 / 22877 |  |

## Production heap cap (`--max-old-space-size=64 --max-semi-space-size=2`)

| Heap capped at 64 MB | `readFileSync` | `createReadStream` |
|---|---|---|
| Result | 💥 crashed: JavaScript heap out of memory | ✅ 71.1 MB RSS · 5.35s |

## Reading the numbers

- **Peak memory** — `readFileSync` holds the whole file, every line and every parsed object at the same time: memory grows linearly with the file size. The stream holds one 64 KB chunk and one batch of 1,000 rows: memory is flat whatever the file size.
- **Longest event loop block** — the longest period during which the process could not do anything else (answer HTTP requests, health checks, timers). The sync strategy freezes the process for the whole parse; the stream yields between chunks.
- **Total time** — the stream pays a small per-row `await` cost; in the real import the database round-trips dominate anyway.
- **Heap cap** — the streaming importer's live heap is ~16 MB, so it runs comfortably inside a 64 MB heap. The same cap kills the `readFileSync` approach.

Reproduce with `npm run benchmark`.
