# Sable

Sable is a Bloomberg Terminal-style sports betting intelligence dashboard for the TxODDS x Solana World Cup Hackathon 2026.

It is not a sportsbook. It is a real-time cockpit for sports bettors, prediction market operators, and builders who need to inspect TxLINE-powered match events, consensus odds movement, resolution receipts, and devnet settlement flows.

## Run

```bash
npm run dev
```

Then open:

```txt
http://localhost:3000
```

No dependency install is required for the current demo build.

## Demo Commands

```txt
MATCH BRA-ARG
ODDS BRA-ARG
STEAM --live
PROOF BRA_ML
SETTLE BRA_ML
WATCH USA-ENG
```

## TxODDS Credentials

Copy `.env.example` values into your environment when enabling live TxLINE proxying:

```txt
TXLINE_NETWORK=devnet
TXLINE_GUEST_JWT=<jwt from POST /auth/guest/start>
TXLINE_API_TOKEN=<token from POST /api/token/activate>
```

The browser never sees these credentials. The Node server attaches them to TxODDS requests.

## Current Build

- Demo SSE fixture replay with `BRA vs ARG` and `USA vs ENG`
- Real-time match tape
- Odds monitor with implied probabilities
- Steam move detection
- Command-driven navigation
- Resolution receipt drawer with TxLINE-shaped Merkle proof fields
- Devnet settlement simulation using SOL/USDC-style escrow semantics

## Docs

- [Architecture](docs/architecture.md)
- [TxODDS integration](docs/txodds-integration.md)
- [Demo script](docs/demo-script.md)
