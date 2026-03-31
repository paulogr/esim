# Product Ingestion Queue Offload

## Why

The current ingestion entrypoint (`packages/product/index.ts`) runs all provider pipelines in parallel in one scheduled Worker invocation via `Promise.allSettled`.

Because provider payloads can be large, this design concentrates memory and failure risk in a single execution. One oversized response or transient provider failure can degrade the entire run.

We need to isolate provider processing, reduce peak memory per invocation, and introduce controlled retry behavior that does not repeatedly impact the scheduler path.

## What

Move ingestion execution to a queue-backed flow using one shared queue:

- The scheduler publishes one message per provider (`esimaccess`, `esimcard`, `esimgo`) to `esim-product-ingest`.
- The same worker consumes queue messages and dispatches to the corresponding provider pipeline.
- Queue consumer runs with `max_batch_size: 1` so each invocation processes only one provider message.
- Retry behavior:
  - Queue config uses `max_retries: 2` (initial attempt + 2 retries).
  - Consumer applies exponential backoff delay in code when calling `message.retry({ delaySeconds })`.
  - Messages exceeding retries move to DLQ `esim-product-ingest-dlq`.
- Message payload type uses the existing canonical `Provider` union from `packages/product/types.ts`.

Expected runtime behavior:

- Cron schedule remains the ingestion trigger.
- Scheduler becomes a lightweight enqueuer.
- Provider ingestion executes asynchronously per message.
- Failed provider jobs retry with backoff, then isolate into DLQ.

## Constraints

Must-have:

- Single shared queue for all providers (`esim-product-ingest`).
- DLQ configured as `esim-product-ingest-dlq`.
- Consumer implemented on the same worker runtime.
- Queue consumer `max_batch_size` must be `1`.
- Do not set `max_batch_timeout`.
- Queue retry config must be `max_retries: 2`.
- Use `Provider` from `packages/product/types.ts` for message typing/routing.

Must-not:

- Do not keep provider execution in scheduler via `Promise.allSettled`.
- Do not create one queue per provider.
- Do not alter provider pipeline semantics beyond invocation context (scheduler vs queue consumer).

Out of scope:

- Provider API contract changes.
- Database schema/model changes.
- Refactoring provider mapping logic in `packages/product/esimaccess.ts`, `packages/product/esimcard.ts`, or `packages/product/esimgo.ts`.
- Building DLQ replay tooling or an operator UI.

## Current state

- `packages/product/index.ts` currently runs `runEsimAccessPipeline`, `runEsimCardPipeline`, and `runEsimGoPipeline` concurrently inside `scheduled()` and logs rejected results.
- `packages/product/wrangler.jsonc` includes D1 and env vars, but has no queue producer/consumer configuration and no DLQ configuration.
- `packages/product/worker.d.ts` includes `DB` and API key bindings in `Env`; no queue binding is present.
- `packages/product/types.ts` already defines `Provider = "esimaccess" | "esimgo" | "esimcard"`, which can be reused for queue message payloads.

## Tasks

1. Add queue infrastructure config in `packages/product/wrangler.jsonc` (producer, consumer, DLQ, retry settings).
2. Regenerate worker types in `packages/product/worker.d.ts` so queue bindings are reflected in `Env`.
3. Refactor `packages/product/index.ts` so `scheduled()` only enqueues provider messages instead of running pipelines directly.
4. Add queue consumer routing in `packages/product/index.ts` that validates provider payloads and invokes the correct pipeline.
5. Implement consumer retry strategy with exponential delay and explicit `message.retry({ delaySeconds })` behavior.
6. Add/update tests for scheduler enqueue behavior, consumer routing, and retry handling.
