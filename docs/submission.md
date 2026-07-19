# Sable Hackathon Submission

## Project Summary

Sable is a Bloomberg Terminal-style sports betting intelligence dashboard powered by TxODDS/TxLINE data. It is not a sportsbook. It is a professional market cockpit for bettors, analysts, and prediction market operators who need to inspect live fixtures, odds movement, market volatility, and verifiable resolution data.

## Core Features

- Live TxODDS fixture loading and fixture-scoped odds/scores views.
- Server-side TxODDS credential handling so API tokens never reach the browser.
- TxODDS SSE proxy for live odds and score events.
- Market Wire that translates raw TxODDS events into readable betting context.
- Odds Monitor with wager cards, implied probability, movement, and mini charts.
- Dedicated wager chart pages for individual outcomes.
- Event-based price history assembled from TxODDS snapshots, historical rows, and live SSE ticks.
- Market Scanner for sharp implied-probability movement.
- TxLINE proof drawer for stat-validation receipts and Merkle proof fields.
- Simulated peer-to-peer prediction exchange with in-memory balances, back/lay orders, matching, 5% rake, and settlement receipts.

## TxODDS / TxLINE Endpoints Used

```txt
POST /auth/guest/start
POST /api/token/activate
GET  /api/fixtures/snapshot
GET  /api/odds/snapshot/{fixtureId}
GET  /api/odds/stream
GET  /api/scores/stream
GET  /api/scores/stat-validation
```

Sable exposes these local proxy routes to the browser:

```txt
GET  /api/txline/status
GET  /api/txline/fixtures
GET  /api/txline/odds/:fixtureId
GET  /api/txline/odds-history/:fixtureId
GET  /api/txline/scores/:fixtureId
GET  /api/stream
GET  /api/proofs/stat
GET  /api/exchange/user/:userId
GET  /api/exchange/book/:marketId
POST /api/exchange/orders
POST /api/exchange/settle
```

## Data Flow

```txt
TxODDS / TxLINE API
  fixtures, odds snapshots, odds SSE, scores SSE, stat proofs
        |
        | private server-side credentials
        v
Sable Node Server
  normalizes fixture, score, odds, proof, and exchange data
        |
        | browser-safe JSON and Server-Sent Events
        v
Sable Terminal UI
  Market Wire, Odds Monitor, Wager Chart, Market Scanner, Proof Drawer, P2P Trade Ticket
```

## Credential Strategy

TxODDS credentials are stored only in server-side environment variables:

```txt
TXLINE_NETWORK=devnet
TXLINE_GUEST_JWT=<guest jwt>
TXLINE_API_TOKEN=<activated api token>
```

The browser calls Sable's local API routes. The Node server attaches:

```txt
Authorization: Bearer <TXLINE_GUEST_JWT>
X-Api-Token: <TXLINE_API_TOKEN>
```

## Exchange Safety

Sable does not use TxLINE's internal credit token for user wagering. The exchange layer is simulated for the hackathon demo:

- no real money
- no P2P asset transfer
- no blockchain transaction
- in-memory user balances only
- back/lay order matching for demonstration
- 5% simulated rake

This lets judges inspect the prediction market UX and deterministic order logic without legal or custody risk.

## Verification Layer

Sable can request TxLINE stat-validation proof responses through `/api/proofs/stat` and display:

- observed fixture sequence
- stat keys
- event/stat root
- daily scores PDA derivation context
- Merkle proof path
- signed payload/proof metadata

For this build, the proof UI is focused on human-readable verification and demo clarity.
