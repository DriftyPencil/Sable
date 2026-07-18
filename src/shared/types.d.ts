export type StreamSource = "txline-live" | "txline-historical" | "demo";

export type MatchEventType =
  | "match_status"
  | "goal"
  | "card"
  | "substitution"
  | "var"
  | "odds_tick"
  | "market_resolved"
  | "heartbeat";

export interface MatchEvent {
  id: string;
  source: StreamSource;
  fixtureId: string;
  demoFixtureId?: string;
  seq: number;
  txlineEventName?: string;
  type: MatchEventType;
  ts: string;
  matchClock?: {
    minute: number;
    stoppage?: number;
    period: "NS" | "H1" | "HT" | "H2" | "ET" | "PEN" | "FT";
  };
  teams: {
    home: string;
    away: string;
  };
  score?: {
    home: number;
    away: number;
  };
  actor?: {
    playerId?: string;
    playerName?: string;
    team: "home" | "away";
  };
  payload: unknown;
}

export type MarketType =
  | "match_winner"
  | "total_goals"
  | "first_scorer"
  | "player_prop";

export type MarketStatus = "open" | "suspended" | "resolved" | "void";

export interface Market {
  id: string;
  fixtureId: string;
  type: MarketType;
  label: string;
  selection: string;
  line?: number;
  status: MarketStatus;
  currentOddsDecimal: number;
  impliedProbability: number;
  volumeUsd: number;
  liquidityUsd: number;
  resolvedOutcome?: string;
  resolutionRule: {
    statKeys: number[];
    predicate: string;
  };
}

export interface OddsSnapshot {
  id: string;
  marketId: string;
  fixtureId: string;
  ts: string;
  decimal: number;
  american?: number;
  impliedProbability: number;
  consensusSpreadBps?: number;
  sourceCount: number;
  volumeUsd?: number;
  txlineRaw?: unknown;
}

export interface LineMovementAlert {
  id: string;
  fixtureId: string;
  marketId: string;
  ts: string;
  severity: "info" | "warning" | "critical";
  kind:
    | "steam_move"
    | "stale_line"
    | "volatility_spike"
    | "post_event_reprice";
  message: string;
  deltaProbabilityBps: number;
  windowSec: number;
  triggeredByEventId?: string;
}

export interface MerkleNode {
  hash: string;
  isRightSibling: boolean;
}

export interface ResolutionReceipt {
  id: string;
  fixtureId: string;
  marketId: string;
  seq: number;
  status: "pending" | "verified" | "rejected" | "simulated";
  resolvedOutcome: string;
  txlinePayloadHash: string;
  signedPayload?: unknown;
  statValidation: {
    statKeys: number[];
    targetTsMs: number;
    epochDay: number;
    dailyScoresRootsPda: string;
    fixtureSummary: unknown;
    eventStatRoot: string;
    subTreeProof: MerkleNode[];
    mainTreeProof: MerkleNode[];
    statProofs: MerkleNode[][];
  };
  solana?: {
    cluster: "devnet" | "mainnet";
    txSignature?: string;
    explorerUrl?: string;
  };
  createdAt: string;
}

export interface EscrowPosition {
  id: string;
  userWallet: string;
  marketId: string;
  selection: string;
  amountLamports?: string;
  amountUsdc?: string;
  status: "created" | "locked" | "settling" | "settled" | "refunded" | "failed";
  escrowPda: string;
  vaultPda: string;
  openTx?: string;
  settleTx?: string;
}

export interface TerminalCommand {
  raw: string;
  verb: "MATCH" | "ODDS" | "STEAM" | "PROOF" | "SETTLE" | "WATCH" | "HELP";
  args: string[];
  flags: Record<string, string | boolean>;
}
