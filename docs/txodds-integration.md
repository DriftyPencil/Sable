# TxODDS Integration

## Endpoints Used

```txt
POST /auth/guest/start
POST /api/token/activate
GET  /api/fixtures/snapshot
GET  /api/odds/snapshot/{fixtureId}
GET  /api/odds/stream
GET  /api/scores/stream
GET  /api/scores/stat-validation
```

## Auth Strategy

Sable keeps TxODDS credentials server-side. The browser never receives the guest JWT or activated API token.

```txt
TXLINE_NETWORK=devnet
TXLINE_GUEST_JWT=<jwt from /auth/guest/start>
TXLINE_API_TOKEN=<token from /api/token/activate>
```

The server adds:

```txt
Authorization: Bearer <TXLINE_GUEST_JWT>
X-Api-Token: <TXLINE_API_TOKEN>
Accept: text/event-stream
Cache-Control: no-cache
```

## Live Mode

Live path:

```txt
Browser EventSource
  -> GET /api/stream?channel=all&fixtureId=<selected_fixture_id>
  -> Sable server adds private headers
  -> TxODDS /api/scores/stream + /api/odds/stream
  -> fixture-filtered normalized match_event SSE messages
```

## Implemented Sable Proxy Routes

```txt
GET /api/txline/status
  Returns selected network, API base, program ID, and whether credentials are present.

GET /api/txline/fixtures
  Proxies /api/fixtures/snapshot.

GET /api/txline/odds/:fixtureId
  Proxies /api/odds/snapshot/{fixtureId}.

GET /api/txline/scores/:fixtureId
  Checks /api/scores/snapshot/{fixtureId}, /api/scores/updates/{fixtureId}, and /api/scores/historical/{fixtureId}.

GET /api/proofs/stat?fixtureId=<id>&seq=<observed_seq>&statKeys=1,2
  Proxies /api/scores/stat-validation.

GET /api/stream?channel=all&fixtureId=<selected_fixture_id>
  Multiplexes scores and odds SSE streams into Sable's normalized event shape and filters by fixture.
```

## Settlement Strategy

Sable does not use TxLINE's credit token for user wagering. Any settlement concept uses devnet SOL or USDC controlled by Sable's escrow program.

```txt
settle_market
  accounts:
    user signer
    market PDA
    escrow vault PDA
    winner token account
    TxLINE program
    daily_scores_roots PDA

  args:
    fixtureId
    seq
    statKeys
    validation payload
    predicate strategy

  behavior:
    CPI into TxLINE validateStatV2.
    If validation passes, mark market resolved and release escrow.
```

For this 24-hour build, `/api/settlement/simulate` returns a devnet-shaped settlement object and explorer URL after a proof receipt exists. The UI presents this as a deterministic simulation, not real-money wagering.
