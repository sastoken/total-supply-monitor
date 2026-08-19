# ADR-001: Use pinned on-chain snapshots and a dynamic vesting exclusion

## Status

Accepted

## Date

2026-08-19

## Context

SAL needs public total- and circulating-supply endpoints suitable for market-data ingestion. Supply values must be derived from BNB Smart Chain rather than a mutable off-chain counter. The primary engineering risks are stale or inconsistent blockchain reads, arithmetic precision loss, RPC outages, and unsupported assumptions about what is non-circulating.

The active public-sale allocation is held by the SAL vesting contract at `0x67845b2fa5ec5b963cc7b0e871b1ae6d45833c25`. Its current balance changes as tokens are claimed. SAL liquidity in DEX pools is available for market trading.

## Decision

- Use Cloudflare Workers with viem read-only RPC calls on BSC chain ID `56`.
- Require two HTTPS RPC secrets; use ordered, bounded primary/secondary failover with no unbounded retries.
- Validate the chain ID before every uncached supply snapshot.
- Read one block number, then pass it to `totalSupply`, `decimals`, and every exclusion `balanceOf` call.
- Keep raw quantities as `bigint`; format only at the HTTP response boundary.
- Calculate circulating supply as `totalSupply - sum(live balanceOf(exclusions))`; fail closed if the invariant is invalid.
- Exclude only the full live SAL balance of the public-sale vesting contract. Do not deduct a fixed allocation amount.
- Treat liquidity-pool balances as circulating.
- Include `block_number` in JSON metadata and success logs. `updated_at` denotes API response-generation time, not a BSC block timestamp.
- Cache successful supply responses for the configured short TTL. Do not cache errors as plausible numeric responses.

## Alternatives considered

### Fixed supply deduction

Rejected. A static deduction becomes inaccurate when a vesting contract transfers or distributes SAL.

### Exclude every large project-related wallet

Rejected. Holder size alone does not establish non-circulating status. Each future exclusion requires an address, controller, lock/control rationale, and supporting evidence.

### Exclude DEX liquidity

Rejected. Pool balances support active market trading, so excluding them would understate available circulation.

### Stale-if-error cache fallback

Deferred. It could improve availability, but requires explicit freshness metadata and an agreed staleness policy so cached data cannot be mistaken for a current snapshot.

### Multicall batching

Deferred. The initial single-exclusion configuration does not justify extra protocol complexity. It can be introduced when the approved exclusion list expands.

### Full vesting-accounting calculation

Deferred pending market-data policy review. The current public contract reports the vesting contract's live SAL balance as locked. If CMC policy requires claimable tokens to be counted differently, revise the exclusion methodology through a new ADR and test it against contract state.

## Consequences

- Responses are reproducible for the reported block number, subject to RPC provider consistency.
- The API does not decide CMC policy; it publishes a transparent, documented calculation.
- Addition of treasury, team, ecosystem, advisor, development, burn, or other wallets requires separate evidence and approval before deployment.
- Production operations must monitor RPC failures, chain mismatches, cache behavior, and invariant failures without logging RPC URLs or credentials.
