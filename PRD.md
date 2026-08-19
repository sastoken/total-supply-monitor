# PRD — CMC ERC-20 Supply API for BNB Smart Chain

**Project:** Token Supply API / CoinMarketCap Integration  
**Target:** ERC-20 / BEP-20 token deployed on BNB Smart Chain (BSC)  
**Runtime:** Cloudflare Workers  
**Language:** TypeScript  
**On-chain client:** viem  
**Status:** Development specification  
**Version:** 1.0

---

## 1. Executive Summary

Build a small, public, read-only API that exposes total and circulating token supply for a BSC ERC-20/BEP-20 asset. The primary consumer is CoinMarketCap (CMC), while a JSON metadata endpoint is provided for transparency, monitoring, and future integrations.

The service MUST derive authoritative token state from BSC rather than maintaining a mutable off-chain supply counter. `totalSupply()` and `decimals()` are read from the token contract. Circulating supply is calculated from total supply minus explicitly configured non-circulating balances.

Primary goals:

- Public HTTPS endpoints with no authentication.
- Deterministic supply values.
- On-chain source of truth.
- Cloudflare serverless deployment.
- Minimal operational burden.
- Safe handling of RPC failures and invalid responses.
- Transparent exclusion policy for circulating supply.

Non-goal: this service does not decide which balances CMC itself will accept as circulating. The project must expose a defensible calculation; CMC may independently verify or adjust reported supply.

---

## 2. Product Scope

### 2.1 In scope

1. `GET /total-supply`
2. `GET /circulating-supply`
3. `GET /supply.json`
4. Optional `GET /health`
5. BSC RPC reads
6. Configurable exclusion addresses
7. Cloudflare edge caching
8. RPC failover
9. Structured error handling
10. Unit/integration tests
11. Wrangler deployment configuration
12. Operational documentation

### 2.2 Out of scope

- Token contract deployment.
- Token mint/burn administration.
- CMC account/listing submission automation.
- Holder indexing/database.
- Explorer replacement.
- Wallet authentication.
- Trading/price API.
- Market-cap calculation.
- Modifying on-chain state.

---

## 3. Functional Requirements

### FR-01 — Total Supply

`GET /total-supply` returns the token's human-readable total supply as plain text.

Example:

```text
1000000000
```

Source:

```solidity
totalSupply()
decimals()
```

Formula:

```text
totalSupplyHuman = totalSupplyRaw / 10^decimals
```

Requirements:

- HTTP 200 on success.
- `Content-Type: text/plain; charset=utf-8`.
- No commas, currency symbol, token ticker, explanatory prose, or scientific notation.
- Do not convert large integers through JavaScript `Number` before formatting.

### FR-02 — Circulating Supply

`GET /circulating-supply` returns the calculated circulating supply as plain text.

Formula:

```text
circulatingSupply = totalSupply - SUM(nonCirculatingBalances)
```

Potential exclusions MAY include, after project/CMC policy review:

- treasury wallets;
- team-controlled allocations;
- vesting/lock contracts;
- future ecosystem allocations;
- designated non-circulating reserves;
- other documented addresses that are not freely circulating.

Important: LP balances and burn addresses must not be blindly excluded. Classification is a policy decision and must be documented before production deployment.

### FR-03 — JSON Supply Metadata

`GET /supply.json` provides a machine-readable transparency response.

Recommended schema:

```json
{
  "name": "TOKEN_NAME",
  "symbol": "TOKEN_SYMBOL",
  "network": "bsc",
  "chain_id": 56,
  "contract": "0x...",
  "decimals": 18,
  "total_supply": "1000000000",
  "circulating_supply": "770000000",
  "non_circulating_supply": "230000000",
  "block_number": "12345678",
  "updated_at": "2026-08-19T00:00:00.000Z"
}
```

All token quantities SHOULD be strings to avoid JSON numeric precision issues.

### FR-04 — Health Endpoint

`GET /health` returns service/RPC health without exposing secrets.

Example:

```json
{
  "status": "ok",
  "chain_id": 56,
  "rpc": "reachable"
}
```

The endpoint must not reveal RPC credentials or private configuration.

---

## 4. Circulating Supply Policy

This is the highest-risk part of the implementation.

The engineering formula is easy; deciding which wallets are non-circulating is not. Every exclusion MUST have:

- address;
- label;
- reason;
- controlling party/type;
- whether balance is dynamic;
- supporting evidence/documentation.

Example configuration:

```ts
export const NON_CIRCULATING_ADDRESSES = [
  {
    address: "0x0000000000000000000000000000000000000001",
    label: "Treasury",
    reason: "Project-controlled reserve"
  },
  {
    address: "0x0000000000000000000000000000000000000002",
    label: "Vesting",
    reason: "Locked team allocation"
  }
] as const;
```

Do NOT hardcode a fixed `230000000` deduction if the relevant wallets can move tokens. Query each current `balanceOf(address)`.

Invariant:

```text
0 <= circulatingSupply <= totalSupply
```

If this invariant fails, the request MUST fail rather than publish an invalid number.

---

## 5. Architecture

```text
                 +-------------------+
                 |   CoinMarketCap   |
                 +---------+---------+
                           |
                           | HTTPS GET
                           v
                 +-------------------+
                 | Cloudflare Worker |
                 | Supply API        |
                 +---------+---------+
                           |
                   viem eth_call
                           |
             +-------------+-------------+
             |                           |
             v                           v
       +-----------+               +-----------+
       | BSC RPC A |   failover    | BSC RPC B |
       +-----+-----+               +-----+-----+
             |                           |
             +-------------+-------------+
                           |
                           v
                  +----------------+
                  | Token Contract |
                  | BSC Chain 56   |
                  +----------------+
```

No database is required for v1.

### Request flow

1. Request reaches Cloudflare Worker.
2. Router validates path/method.
3. Supply service requests a consistent on-chain snapshot.
4. Contract client reads token state.
5. For circulating supply, balances of configured exclusions are read.
6. Values are computed using `bigint`/exact decimal formatting.
7. Response is cached briefly at Cloudflare edge.
8. On primary RPC failure, retry/fail over according to bounded policy.
9. If no valid fresh result can be produced, return an error rather than fabricated data.

---

## 6. Consistency Requirements

For circulating supply, reading `totalSupply()` and multiple `balanceOf()` calls at unrelated block heights can theoretically create inconsistent results during transfers/mints/burns.

Preferred implementation:

1. Read current block number.
2. Execute all contract reads using the same `blockNumber` where supported.
3. Return that block number in `/supply.json`.

This makes the result reproducible and auditable.

---

## 7. Technology Stack

| Component | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| Language | TypeScript |
| Package manager | pnpm |
| Ethereum client | viem |
| Chain | BNB Smart Chain mainnet |
| Chain ID | 56 |
| Config/deployment | Wrangler |
| Testing | Vitest + Workers test tooling where applicable |
| Formatting/lint | Prettier + ESLint or Biome |
| CI | GitHub Actions |

D1/KV/R2 are deliberately excluded from the initial architecture because the service has no persistence requirement.

---

## 8. Repository Structure

```text
cmc-supply-api/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── abi/
│   │   └── erc20.ts
│   ├── blockchain/
│   │   ├── client.ts
│   │   └── rpc.ts
│   ├── services/
│   │   └── supply.ts
│   ├── routes/
│   │   ├── total-supply.ts
│   │   ├── circulating-supply.ts
│   │   ├── supply-json.ts
│   │   └── health.ts
│   └── utils/
│       ├── response.ts
│       └── supply-format.ts
├── test/
│   ├── supply.test.ts
│   ├── routes.test.ts
│   └── fixtures.ts
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── README.md
└── .github/
    └── workflows/
        └── deploy.yml
```

---

## 9. Configuration

Public/non-secret configuration:

```text
TOKEN_ADDRESS
TOKEN_NAME
TOKEN_SYMBOL
CHAIN_ID=56
CACHE_TTL=60
```

Secrets:

```text
BSC_RPC_URL_PRIMARY
BSC_RPC_URL_SECONDARY
```

If using credential-bearing RPC URLs, store them with Wrangler secrets, never in Git.

Token address must be validated at startup/request initialization as a valid EVM address.

---

## 10. ERC-20 ABI

Minimum ABI:

```ts
export const ERC20_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
```

Optional `name()` and `symbol()` reads may be added for diagnostics, but production identity should not depend on them if the token is non-standard.

---

## 11. API Contract

### GET `/total-supply`

Success:

```http
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Cache-Control: public, max-age=60

1000000000
```

### GET `/circulating-supply`

Success:

```http
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Cache-Control: public, max-age=60

770000000
```

### GET `/supply.json`

Success: HTTP 200 JSON.

### Unsupported method

Return `405 Method Not Allowed`.

### Unknown path

Return `404 Not Found`.

### Upstream failure

Return `503 Service Unavailable` with JSON for diagnostic endpoints. Supply endpoints must never return a plausible-looking numeric fallback unless a deliberately designed stale-cache policy exists and is clearly bounded.

---

## 12. Caching Strategy

Recommended initial TTL: **60 seconds**.

Rationale:

- Supply does not need block-by-block freshness for CMC ingestion.
- Reduces RPC calls.
- Reduces exposure to provider rate limits.
- Improves latency/reliability.

Suggested headers:

```text
Cache-Control: public, max-age=60, s-maxage=60
```

Do not cache upstream errors as successful responses.

Optional future enhancement: Cache API with a short stale-if-error window. If implemented, `/supply.json` must expose freshness metadata so stale data cannot be mistaken for a current chain snapshot.

---

## 13. RPC Reliability

Use at least two BSC RPC providers in production.

Algorithm:

```text
request
  -> primary RPC
       -> success: return
       -> timeout/network error: secondary RPC
            -> success: return
            -> failure: 503
```

Rules:

- Keep per-RPC timeout bounded.
- Avoid infinite retries.
- Do not retry deterministic contract reverts indefinitely.
- Validate chain ID when appropriate to prevent accidental connection to the wrong chain.
- Log provider category/name, never secret URLs.

---

## 14. Precision and Numeric Safety

Token amounts MUST remain `bigint` until formatting.

Incorrect:

```ts
Number(rawSupply) / 10 ** decimals
```

Correct approach:

```ts
formatUnits(rawSupply, decimals)
```

The output formatter SHOULD normalize unnecessary trailing decimal zeros while preserving exactness.

Tests must cover:

- 18 decimals;
- non-18-decimal tokens;
- very large uint256 values;
- fractional human-readable supply;
- zero supply;
- exclusion sum equal to total supply.

---

## 15. Security Requirements

Although read-only, the endpoint is public infrastructure and must be hardened.

### Required

- No private keys.
- No wallet signing.
- No transaction submission.
- No admin mutation endpoint.
- RPC credentials stored as secrets.
- Only GET/HEAD where required.
- Strict route matching.
- No user-controlled RPC URL.
- No arbitrary contract address supplied through query parameters.
- Dependency lockfile committed.
- Production dependencies kept minimal.

### Cloudflare

Optional abuse controls:

- WAF managed protections.
- Rate limiting only if abuse becomes material.
- Bot controls must not accidentally block CMC's crawler/ingestion infrastructure.

The supply endpoint should remain publicly retrievable without cookies, JavaScript challenges, authentication, or browser-only behavior.

---

## 16. Observability

Log structured events such as:

```json
{
  "event": "supply_read",
  "endpoint": "/circulating-supply",
  "block_number": "12345678",
  "rpc_provider": "primary",
  "duration_ms": 84,
  "status": 200
}
```

Never log RPC API keys.

Monitor:

- HTTP 5xx rate;
- RPC error rate;
- endpoint latency;
- invalid supply invariant;
- deployment failures.

---

## 17. Testing Plan

### Unit tests

- raw supply formatting;
- exclusion summation;
- circulating supply calculation;
- duplicate exclusion protection;
- invalid invariant detection;
- decimal handling;
- response formatting.

### Integration tests

Against BSC mainnet or controlled RPC:

1. `eth_chainId == 56`.
2. Contract bytecode exists at configured address.
3. `totalSupply()` succeeds.
4. `decimals()` succeeds.
5. Every exclusion `balanceOf()` succeeds.
6. Circulating supply is within invariant bounds.

### API tests

```text
GET /total-supply          -> 200 + plain number
GET /circulating-supply    -> 200 + plain number
GET /supply.json           -> 200 + valid JSON
GET /health                -> 200 when healthy
POST /total-supply         -> 405
GET /unknown               -> 404
RPC outage                 -> bounded failover / 503
```

---

## 18. CI/CD

GitHub Actions pipeline:

```text
push / pull request
       |
       +--> install
       +--> typecheck
       +--> lint
       +--> unit tests
       +--> build

main branch
       |
       +--> production deployment
```

Cloudflare credentials must use GitHub encrypted secrets/OIDC-supported workflow as appropriate.

Do not deploy pull requests automatically to the production route.

---

## 19. Deployment

Recommended production hostname:

```text
cmc.sastoken.io
```

Routes:

```text
https://cmc.sastoken.io/total-supply
https://cmc.sastoken.io/circulating-supply
https://cmc.sastoken.io/supply.json
https://cmc.sastoken.io/health
```

Deployment flow:

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm wrangler deploy
```

Then verify externally with `curl`, not only from a local environment.

---

## 20. Production Verification Checklist

- [ ] Correct BSC token contract address configured.
- [ ] Chain ID confirmed as 56.
- [ ] Contract bytecode exists.
- [ ] `totalSupply()` verified against explorer/on-chain RPC.
- [ ] `decimals()` verified.
- [ ] Every non-circulating wallet reviewed manually.
- [ ] No duplicate exclusion addresses.
- [ ] Exclusion rationale documented.
- [ ] `/total-supply` returns only a plain number.
- [ ] `/circulating-supply` returns only a plain number.
- [ ] No auth/cookie/browser challenge required.
- [ ] HTTPS works publicly.
- [ ] RPC secrets are not committed.
- [ ] Secondary RPC tested.
- [ ] 60-second cache works.
- [ ] RPC outage behavior tested.
- [ ] CMC submission values match the API methodology.

---

## 21. Development Tasks

### Phase 1 — Bootstrap

- [ ] Initialize TypeScript Worker.
- [ ] Install viem.
- [ ] Configure Wrangler.
- [ ] Configure BSC chain.
- [ ] Add environment validation.

### Phase 2 — Blockchain layer

- [ ] ERC-20 ABI.
- [ ] RPC client factory.
- [ ] Primary/secondary RPC handling.
- [ ] Read consistent block snapshot.
- [ ] Implement total supply read.
- [ ] Implement decimals read.
- [ ] Implement exclusion balance reads.

### Phase 3 — Supply engine

- [ ] Exact unit formatting.
- [ ] Calculate total supply.
- [ ] Calculate non-circulating supply.
- [ ] Calculate circulating supply.
- [ ] Add invariant validation.
- [ ] Prevent duplicate exclusions.

### Phase 4 — HTTP API

- [ ] `/total-supply`.
- [ ] `/circulating-supply`.
- [ ] `/supply.json`.
- [ ] `/health`.
- [ ] 404/405 handling.
- [ ] Cache headers.

### Phase 5 — Quality

- [ ] Unit tests.
- [ ] Integration tests.
- [ ] RPC failure tests.
- [ ] Precision tests.
- [ ] Typecheck/lint.

### Phase 6 — Deployment

- [ ] Create Cloudflare Worker.
- [ ] Add RPC secrets.
- [ ] Configure custom domain.
- [ ] Deploy production.
- [ ] Validate via external curl.
- [ ] Compare supply against BSC explorer data.

### Phase 7 — CMC readiness

- [ ] Final circulating-supply wallet classification review.
- [ ] Prepare contract/explorer references.
- [ ] Prepare supply endpoint URLs.
- [ ] Record calculation methodology.
- [ ] Submit/update CMC request manually.

---

## 22. Acceptance Criteria

The product is complete when:

1. Production endpoints are publicly accessible over HTTPS.
2. Total supply is calculated from BSC contract state.
3. Circulating supply is calculated from documented dynamic on-chain balances.
4. Results use exact arithmetic and are deterministic for a given block.
5. Both plain-text supply endpoints contain only valid numeric values.
6. RPC failure cannot silently produce fabricated supply.
7. The service can survive failure of the primary RPC using a secondary provider.
8. No secret/private key is exposed.
9. Tests cover arithmetic, routes, and failure modes.
10. Supply methodology and excluded wallets are documented before CMC submission.

---

## 23. Decisions Required Before Coding Production Values

The implementation can be built generically now, but production cannot be finalized until these values are supplied:

```text
TOKEN_NAME=
TOKEN_SYMBOL=
TOKEN_ADDRESS=
TOKEN_DECIMALS=on-chain
PRIMARY_RPC=
SECONDARY_RPC=
PUBLIC_DOMAIN=api.sastoken.io
```

And, critically:

```text
NON_CIRCULATING_ADDRESSES:
- address:
  label:
  reason:
- address:
  label:
  reason:
```

Do not infer these addresses from holder size alone. A large holder is not automatically non-circulating, and a project-related address is not automatically eligible for exclusion under every market-data methodology.

---

## 24. Future Enhancements

Only add these if operational requirements justify them:

- Multicall batching for exclusion balances.
- Explicit stale-cache fallback with freshness metadata.
- Supply history snapshots.
- Prometheus-compatible metrics gateway.
- Multiple token support.
- Multiple EVM chains.
- Signed audit snapshots.
- Public page documenting exclusion addresses and methodology.

Keep v1 intentionally narrow. A supply endpoint used for market-data ingestion benefits more from determinism, auditability, and uptime than from feature breadth.
