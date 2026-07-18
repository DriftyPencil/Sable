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

Generate devnet TxODDS credentials with:

```bash
npm run txline:credentials
```

This creates or reuses a local gitignored `devnet-wallet.json`, subscribes to the TxLINE devnet free tier, activates the API token, and writes `.env`.

If the Solana devnet faucet is rate-limited, fund the printed devnet address at [faucet.solana.com](https://faucet.solana.com), then rerun the same command.

The resulting `.env` contains:

```txt
TXLINE_NETWORK=devnet
TXLINE_GUEST_JWT=<jwt from POST /auth/guest/start>
TXLINE_API_TOKEN=<token from POST /api/token/activate>
```

The browser never sees these credentials. The Node server attaches them to TxODDS requests.

Check readiness:

```bash
curl http://localhost:3000/api/txline/status
```

See [Real TxODDS Data](docs/live-data.md) for the activation checklist.

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
- [Real TxODDS data](docs/live-data.md)
- [Demo script](docs/demo-script.md)
