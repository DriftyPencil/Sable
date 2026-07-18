# Sable Architecture

Sable is a Bloomberg Terminal-style intelligence cockpit for World Cup betting operators. It is not a sportsbook and does not use TxLINE's internal credit token for end-user staking, wagering, or transfers.

## Runtime

```txt
TxLINE API
  /api/fixtures/snapshot
  /api/odds/snapshot/{fixtureId}
  /api/odds/stream
  /api/scores/stream
  /api/scores/stat-validation
        |
        | Authorization: Bearer <guest_jwt>
        | X-Api-Token: <activated_api_token>
        v
Sable Node Server
  /api/stream              live TxLINE SSE proxy
  /api/sim/stream          replay fixture JSON as SSE
  /api/proofs/stat         receipt/proof fetch path
  /api/settlement/simulate devnet settlement simulation
  /api/fixtures            available demo fixtures
        |
        | normalized Server-Sent Events
        v
Sable Browser Terminal
  MatchTape
  OddsMonitor
  MarketScanner
  MatchDetailTerminal
  OddsMovementChart
  ResolutionReceiptDrawer
  SettlementConsole
  Command input
```

## TxODDS Integration Notes

The docs require network consistency across Solana RPC, TxLINE program ID, TxL mint, guest auth host, activation endpoint, and API base.

```txt
Mainnet program: 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA
Mainnet API:     https://txline.txodds.com/api/

Devnet program:  6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
Devnet API:      https://txline-dev.txodds.com/api/
```

Sable expects:

```txt
TXLINE_NETWORK=devnet
TXLINE_GUEST_JWT=<from POST /auth/guest/start>
TXLINE_API_TOKEN=<from POST /api/token/activate>
```

Data requests include both:

```txt
Authorization: Bearer <guest_jwt>
X-Api-Token: <activated_api_token>
```

For live demos, `/api/stream?channel=scores` proxies TxLINE's scores SSE stream. For guaranteed hackathon judging, `/api/sim/stream` emits the same normalized event shape from committed fixtures.

## Verification Flow

```txt
1. Receive or replay score event with real observed seq.
2. Resolve market only on game_finalised/statusId=100/period=100.
3. Request proof:
   GET /api/scores/stat-validation?fixtureId=<id>&seq=<seq>&statKeys=1,2
4. Derive daily_scores_roots PDA:
   ["daily_scores_roots", epoch_day_u16_le]
5. Submit payload and strategy to TxLINE validateStatV2.
6. Sable receipt drawer displays:
   payload hash, stat keys, event root, PDA, Merkle proof path, validation state.
7. Devnet escrow settlement can release SOL/USDC after validation passes.
```

Current implementation uses simulated receipts for the demo fixtures and preserves the production fields required to swap in the real TxODDS proof response.
