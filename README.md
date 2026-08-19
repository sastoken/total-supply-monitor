# SAL Supply API

Public read-only BNB Smart Chain API for SAL total and circulating supply. Intended for transparent market-data ingestion, including CoinMarketCap review. See [`docs/decisions/ADR-001`](docs/decisions/ADR-001-supply-snapshot-and-exclusion-policy.md) for the supply methodology rationale.

## Endpoints

| Endpoint                  | Success body                                    | Error body       |
| ------------------------- | ----------------------------------------------- | ---------------- |
| `GET /total-supply`       | Exact human-readable total supply, plain text   | `{"error":"…​"}` |
| `GET /circulating-supply` | Exact calculated circulating supply, plain text | `{"error":"…​"}` |
| `GET /supply.json`        | Auditable supply metadata JSON                  | `{"error":"…​"}` |
| `GET /health`             | RPC reachability and chain ID                   | `{"error":"…​"}` |

`HEAD` is supported with the same status and headers and an empty body. Other methods return `405` with `Allow: GET, HEAD`. Unknown paths and any query string return `404`. Upstream, chain, or invariant failures return `503` with `{"error":"supply_unavailable"}`; the API never substitutes a fabricated numeric fallback.

Supply responses use `Cache-Control: public, max-age=<CACHE_TTL>, s-maxage=<CACHE_TTL>` and `X-Content-Type-Options: nosniff`. Health and error responses are `Cache-Control: no-store`.

## Supply methodology

```text
circulating supply = totalSupply() - sum(balanceOf(non-circulating addresses))
```

- SAL contract: [`0x65b98b81f2525efd6c3f49c44de56db7ea662551`](https://bscscan.com/token/0x65b98b81f2525efd6c3f49c44de56db7ea662551)
- BSC chain ID: `56`
- Active exclusion: public-sale vesting contract [`0x67845b2fa5ec5b963cc7b0e871b1ae6d45833c25`](https://bscscan.com/address/0x67845b2fa5ec5b963cc7b0e871b1ae6d45833c25)
- The vesting deduction is its live SAL `balanceOf`, never a hardcoded value.
- SAL in DEX liquidity pools remains circulating. It is not excluded.
- Treasury, ecosystem, development, team, advisor, and ownership allocation addresses are **not** excluded yet. Add only after documented lock/control evidence and policy approval.

All arithmetic remains `bigint` until exact decimal formatting. Each snapshot verifies the chain ID, reads the block number first, then sends all token reads with that same block number. Upstream quantities are range-validated before use. Invalid states (`circulating < 0` or `circulating > total`) fail closed with `503`.

## `/supply.json` schema

| Field                    | Type   | Notes                                                   |
| ------------------------ | ------ | ------------------------------------------------------- |
| `name`, `symbol`         | string | Token identity                                          |
| `network`                | string | Always `bsc`                                            |
| `chain_id`               | number | Always `56`                                             |
| `contract`               | string | Checksummed SAL address                                 |
| `decimals`               | number | Read from the contract                                  |
| `total_supply`           | string | Exact human-readable value                              |
| `circulating_supply`     | string | Exact human-readable value                              |
| `non_circulating_supply` | string | Exact human-readable value                              |
| `block_number`           | string | BSC block the snapshot was read at                      |
| `updated_at`             | string | API response-generation time (RFC 3339), not block time |

## Commands

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `pnpm install`      | Install dependencies                    |
| `pnpm dev`          | Run the Worker locally with `.dev.vars` |
| `pnpm test`         | Run unit, route, and transport tests    |
| `pnpm typecheck`    | Regenerate runtime types and type-check |
| `pnpm build`        | Dry-run production build                |
| `pnpm format`       | Format the codebase with Prettier       |
| `pnpm format:check` | Verify formatting without writing       |

## Local setup

```bash
pnpm install
cp .dev.vars.example .dev.vars
# Set two real BSC RPC endpoints in .dev.vars.
pnpm dev
```

Then:

```bash
curl http://localhost:8787/total-supply
curl http://localhost:8787/circulating-supply
curl http://localhost:8787/supply.json
curl http://localhost:8787/health
```

## Configuration

Public, non-secret settings live in `wrangler.jsonc` vars. RPC URLs are Wrangler secrets because they may carry credentials.

| Setting                 | Source | Default | Constraint                       |
| ----------------------- | ------ | ------- | -------------------------------- |
| `TOKEN_ADDRESS`         | var    | SAL CA  | Valid EVM address                |
| `TOKEN_NAME`            | var    | `SAL`   | Non-empty string                 |
| `TOKEN_SYMBOL`          | var    | `SAL`   | Non-empty string                 |
| `CHAIN_ID`              | var    | `56`    | Must be `56`                     |
| `CACHE_TTL`             | var    | `60`    | Positive integer ≤ 86400 seconds |
| `RPC_TIMEOUT_MS`        | var    | `5000`  | Positive integer ≤ 60000 ms      |
| `BSC_RPC_URL_PRIMARY`   | secret | —       | HTTPS, distinct from secondary   |
| `BSC_RPC_URL_SECONDARY` | secret | —       | HTTPS, distinct from primary     |

`BSC_RPC_URL_PRIMARY` and `BSC_RPC_URL_SECONDARY` are declared as required secrets in `wrangler.jsonc`, so missing secrets surface during local development and deployment instead of as request-time `503`s.

## Observability

Structured JSON logs are emitted for every request. Supply logs include `block_number` and the non-secret `rpc_provider` category (`primary`, `secondary`, or both). Health logs use `event: health_check`. Failure logs include a sanitized `error_message` with URLs replaced by `[url]`. RPC URLs, credentials, and API keys are never logged.

## Deployment

Set RPC URLs interactively; never put credentials in Git or shell command arguments:

```bash
pnpm wrangler secret put BSC_RPC_URL_PRIMARY
pnpm wrangler secret put BSC_RPC_URL_SECONDARY
pnpm wrangler deploy --dry-run
pnpm wrangler deploy
```

CI runs `format:check`, `typecheck`, `test`, and `build` on every pull request and push to `main`. Production deploys run only from `main` after verification passes. A non-blocking dependency advisory report (`pnpm audit --audit-level=high --prod`) runs in CI; reachable high/critical advisories should be triaged by reachability before the next release.

## Pre-production checklist

- [ ] Verify SAL contract bytecode exists at the configured address.
- [ ] Confirm `decimals()` and `totalSupply()` against an explorer.
- [ ] Confirm the vesting contract `salToken()` matches the SAL address.
- [ ] Confirm both RPC secrets return chain ID `56`.
- [ ] Review every configured exclusion address and rationale.
- [ ] Validate external HTTPS responses match the on-chain snapshot.
- [x] Configure the production hostname `cmc.sastoken.io` in `wrangler.jsonc` and ensure its Cloudflare zone stays active.
- [ ] Record the final circulating-supply wallet classification before CoinMarketCap submission.
