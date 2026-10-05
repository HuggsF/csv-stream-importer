# ADR-004 — Memory budget: prove constant memory, then cap the V8 heap

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

Requirement: *memory usage must stay under 100 MB, even with 500k rows.*

With streams and batching (ADR-001/002) the first full import of 500,000 rows reported a **flat
but high** RSS of ~190 MB. Flat means no leak, so where does the memory go?

Measurements on a 120,000-row import (`process.memoryUsage()` sampled every 100 ms):

| Configuration | Peak RSS | Peak heap total | Peak heap used | Duration |
|---|---:|---:|---:|---:|
| Node defaults | 137.4 MB | 85.4 MB | 50.1 MB | 14.7 s |
| **Live heap** (full GC forced every second) | — | — | **15.9 MB** | — |
| `--max-semi-space-size=2` | 108.9 MB | 55.6 MB | 51.1 MB | 13.9 s |
| `--max-old-space-size=64 --max-semi-space-size=2` | **75.3 MB** | 28.9 MB | 23.9 MB | 14.4 s |

The live heap during the import is **15.9 MB — the same as an idle process with all modules
loaded**. The importer retains nothing per row; the extra memory is short-lived garbage (CSV
cells, SQL strings, domain objects of already-inserted batches) that V8 simply does not collect
yet. By default V8 sizes its heap for throughput on a machine with plenty of RAM: a large young
generation (semi-spaces up to 16–32 MB) and an old generation that grows to a large fraction of
system memory before running a full mark-compact.

## Decision

1. Keep the design that makes memory independent of file size (streams + one batch in flight),
   and **prove** it with the live-heap measurement above rather than trusting RSS.
2. Run the import process with an explicit heap budget, as one would for any memory-bounded
   worker or container:

   ```
   node --max-old-space-size=64 --max-semi-space-size=2 dist/presentation/cli/main.js import …
   ```

   These flags are baked into `npm run import` and `npm run import:prod`.

## Results

Full 500,000-row import (`npm run import:prod`, MySQL 8 in Docker):

| | Peak RSS | Duration | Rows/s |
|---|---:|---:|---:|
| Node defaults | 194.6 MB | 60.6 s | 8,258 |
| With the heap cap | **78.7 MB** | **59.0 s** | **8,470** |

Same throughput, 2.5× less memory, comfortably under the 100 MB budget. Under the same cap the
naive `readFileSync` implementation crashes with *JavaScript heap out of memory*
(`npm run benchmark`).

## Consequences

- ✅ The 100 MB budget holds, and the cap acts as a guard-rail: a future regression that retains
  memory per row fails fast in CI/benchmarks instead of slowly eating a production node.
- ✅ No throughput loss: young-generation scavenges are cheap when almost everything dies young.
- ⚠️ The cap must leave room for the configured batch size: 64 MB is ample up to the 10,000-row
  maximum (measured peak RSS 100 MB with 10,000-row batches). Raise it if the batch limit is
  raised.
- ⚠️ The HTTP server (`npm start`) keeps Node defaults locally because it may run several imports
  concurrently (`IMPORT_QUEUE_CONCURRENCY`); in containers the production image sets
  `NODE_OPTIONS=--max-old-space-size=…` sized for its concurrency.

## Alternatives considered

- **Reduce allocations further** (reuse row objects, avoid per-row domain objects): fights the
  garbage collector instead of configuring it, and sacrifices the domain model for no measurable
  gain — the live set is already minimal.
- **Calling `global.gc()` manually**: requires `--expose-gc`, stalls the loop, and is an
  anti-pattern compared with giving V8 a budget.
