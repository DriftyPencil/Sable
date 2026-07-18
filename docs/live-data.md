# Real TxODDS Data

Sable is wired for real TxODDS data through server-side proxy routes. The browser never receives TxODDS credentials.

## Current Requirement

TxODDS data endpoints require both:

```txt
Authorization: Bearer <guest_jwt>
X-Api-Token: <activated_api_token>
```

A guest JWT alone is not enough. A guest-only fixture request returns:

```txt
403 Missing API token
```

## Configure Sable

Run:

```bash
npm run txline:credentials
```

The script creates or reuses a gitignored `devnet-wallet.json`, requests devnet SOL, submits the free-tier TxLINE subscription, activates the API token, and writes `.env` plus `.env.txline`.

If the faucet returns `429 Too Many Requests`, fund the printed devnet address at [faucet.solana.com](https://faucet.solana.com), then rerun:

```bash
npm run txline:credentials
```

Restart the server:

```bash
npm run dev
```

Check readiness:

```bash
curl http://localhost:3000/api/txline/status
```

When `liveReady` is `true`, switch Sable to `LIVE`.

## Real Routes

```txt
GET /api/txline/status
GET /api/txline/fixtures
GET /api/txline/odds/:fixtureId
GET /api/txline/scores/:fixtureId
GET /api/proofs/stat?source=txline&fixtureId=<id>&seq=<observed_seq>&statKeys=1,2
GET /api/stream?channel=all
```

## Free-Tier Token Flow Used By The Script

Sable uses devnet for hackathon safety. The wallet transaction, guest JWT host, activation endpoint, API base, RPC, and program ID are all devnet.

For devnet:

```txt
Guest auth: https://txline-dev.txodds.com/auth/guest/start
API base:   https://txline-dev.txodds.com/api
Program:    6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
```

Script flow:

```txt
1. POST /auth/guest/start to get a guest JWT.
2. Submit the free World Cup subscription transaction on devnet.
3. Sign this exact message with the same wallet:
   ${txSig}::${jwt}
4. POST /api/token/activate with:
   txSig
   walletSignature base64
   leagues: []
5. Put the returned token into TXLINE_API_TOKEN.
```

Do not commit `.env`.
