# eSIMGo Single Fetch (No Pagination)

## Why

The eSIMGo loader currently performs batched pagination requests even though the provider can now return all products in one call.

Keeping pagination logic adds unnecessary complexity, extra network requests, and diverges from the simpler single-call loading pattern already used by eSIMAccess and eSIMCard.

## What

Simplify eSIMGo ingestion so product loading uses one request with `perPage=6000` and no `page` query parameter.

Expected behavior:

- `loadEsimGoProducts` performs a single HTTP request.
- Request query always includes `perPage=6000`.
- Request does not include `page`.
- Function returns all products from `response.bundles`.
- Tests assert one-call behavior and the new query contract.

## Constraints

Must-have:

- Use `perPage` query param set to `6000`.
- Remove pagination loop logic from eSIMGo loader.
- Remove `page` query param from eSIMGo requests.
- Keep loader behavior aligned with the single-call style used in `packages/product/esimaccess.ts` and `packages/product/esimcard.ts`.

Must-not:

- Do not modify mapping behavior in `mapEsimGoProducts`.
- Do not change other providers' loader behavior.
- Do not introduce new queue, cron, or pipeline orchestration changes.

Out of scope:

- Pricing/allowance/region mapping changes.
- Provider contract changes beyond query parameters for this endpoint.
- Database schema or persistence changes.

## Current state

- `packages/product/esimgo.ts` currently uses pagination constants (`ESIMGO_DEFAULT_PER_PAGE = 200`, `ESIMGO_PAGE_BATCH_SIZE = 3`) and loops through pages in `loadEsimGoProducts`.
- `packages/product/esimgo.ts` currently builds eSIMGo query with both `page` and `perPage` in `fetchEsimGoCataloguePage`.
- `packages/product/esimaccess.ts` and `packages/product/esimcard.ts` loaders both build request options once and call `loadProducts` once.
- `packages/product/tests/esimgo.test.ts` currently validates multi-page behavior (3 calls, page progression, and `perPage=200`).

## Tasks

1. Replace eSIMGo pagination constants with a single per-page constant set to `6000`.
2. Refactor `loadEsimGoProducts` in `packages/product/esimgo.ts` to perform one request and return `response.bundles`.
3. Remove `page` from eSIMGo request query construction and keep only merged query + `perPage`.
4. Simplify/remove helper code tied only to pagination flow (including page-specific function parameters).
5. Update `packages/product/tests/esimgo.test.ts` to assert single-call behavior and `perPage=6000` with no page assertions.
6. Run product tests relevant to eSIMGo loader changes and ensure no regressions.
