import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const publicDir = path.join(rootDir, "public");
const fixturesDir = path.join(rootDir, "fixtures");
await loadLocalEnv(path.join(rootDir, ".env"));
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

async function loadLocalEnv(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function text(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
}

function writeSse(res, event, data, id) {
  if (id) res.write(`id: ${id}\n`);
  if (event) res.write(`event: ${event}\n`);
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of payload.split(/\r?\n/)) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

function parseSseBlock(block) {
  const message = { data: "" };
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value = separatorIndex === -1
      ? ""
      : rawLine.slice(separatorIndex + 1).replace(/^ /, "");
    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }
  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

function parseSseData(data) {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function hashJson(value) {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function fakeBase58(prefix = "") {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = randomBytes(32);
  let out = prefix;
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out.slice(0, prefix ? 44 : 64);
}

function getTxlineConfig() {
  const network = process.env.TXLINE_NETWORK === "mainnet" ? "mainnet" : "devnet";
  const apiBase = network === "mainnet"
    ? process.env.TXLINE_MAINNET_API_BASE || "https://txline.txodds.com/api"
    : process.env.TXLINE_DEVNET_API_BASE || "https://txline-dev.txodds.com/api";
  const programId = network === "mainnet"
    ? process.env.TXLINE_MAINNET_PROGRAM_ID || "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"
    : process.env.TXLINE_DEVNET_PROGRAM_ID || "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
  const guestAuth = network === "mainnet"
    ? "https://txline.txodds.com/auth/guest/start"
    : "https://txline-dev.txodds.com/auth/guest/start";

  return {
    network,
    apiBase: apiBase.replace(/\/$/, ""),
    guestAuth,
    programId,
    jwt: process.env.TXLINE_GUEST_JWT,
    apiToken: process.env.TXLINE_API_TOKEN,
    hasCredentials: Boolean(process.env.TXLINE_GUEST_JWT && process.env.TXLINE_API_TOKEN)
  };
}

function getTxlineHeaders({ sse = false } = {}) {
  const config = getTxlineConfig();
  return {
    Authorization: `Bearer ${config.jwt}`,
    "X-Api-Token": config.apiToken,
    Accept: sse ? "text/event-stream" : "application/json",
    "Cache-Control": "no-cache"
  };
}

function requireTxlineCredentials() {
  const config = getTxlineConfig();
  if (!config.hasCredentials) {
    const error = new Error("Missing TXLINE_GUEST_JWT or TXLINE_API_TOKEN.");
    error.status = 428;
    error.publicDetails = {
      error: "missing_txline_credentials",
      message: "Set TXLINE_GUEST_JWT and TXLINE_API_TOKEN in .env, then restart the Sable server.",
      network: config.network,
      apiBase: config.apiBase
    };
    throw error;
  }
  return config;
}

async function txlineJson(apiPath, searchParams) {
  const config = requireTxlineCredentials();
  const url = new URL(`${config.apiBase}${apiPath}`);
  if (searchParams) {
    for (const [key, value] of searchParams) {
      if (value !== "") url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url, { headers: getTxlineHeaders() });
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }
  if (!response.ok) {
    const error = new Error(`TxODDS request failed with ${response.status}`);
    error.status = response.status;
    error.publicDetails = {
      error: "txline_request_failed",
      status: response.status,
      path: apiPath,
      body
    };
    throw error;
  }
  return body;
}

function pickValue(object, paths) {
  for (const pathExpression of paths) {
    const value = pathExpression.split(".").reduce((current, key) => (
      current && typeof current === "object" ? current[key] : undefined
    ), object);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickNumber(object, paths, fallback = 0) {
  const value = pickValue(object, paths);
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pickString(object, paths, fallback = "") {
  const value = pickValue(object, paths);
  return value === undefined || value === null ? fallback : String(value);
}

function classifyScoreAction(raw) {
  const action = pickString(raw, [
    "action",
    "Action",
    "event",
    "Event",
    "eventType",
    "EventType",
    "Data.Action",
    "Data.Type",
    "data.action",
    "data.type"
  ], "match_status").toLowerCase();

  if (action.includes("goal")) return "goal";
  if (action.includes("card")) return "card";
  if (action.includes("substitution")) return "substitution";
  if (action.includes("var")) return "var";
  return "match_status";
}

function normalizeTxlineScoreMessage(raw, message = {}) {
  const payload = raw && typeof raw === "object" ? raw : { value: raw };
  const seq = pickNumber(payload, ["Seq", "seq", "Sequence", "sequence"], Date.now());
  const fixtureId = pickString(payload, ["FixtureId", "fixtureId", "FixtureID", "fixture_id"], "live");
  const action = pickString(payload, ["Action", "action", "Data.Action", "data.action"], message.event || "score");
  const period = pickString(payload, ["Period", "period", "GamePhase", "gamePhase", "Phase", "phase"], "H1");
  const minute = pickNumber(payload, ["Minute", "minute", "Clock.Minute", "clock.minute", "MatchMinute"], 0);
  const home = pickString(payload, ["Participant1", "participant1", "HomeTeam", "homeTeam"], "Participant 1");
  const away = pickString(payload, ["Participant2", "participant2", "AwayTeam", "awayTeam"], "Participant 2");
  const homeScore = pickNumber(payload, [
    "HomeScore",
    "homeScore",
    "Participant1Score",
    "participant1Score",
    "Score.Home",
    "score.home",
    "Data.HomeScore",
    "data.homeScore"
  ], 0);
  const awayScore = pickNumber(payload, [
    "AwayScore",
    "awayScore",
    "Participant2Score",
    "participant2Score",
    "Score.Away",
    "score.away",
    "Data.AwayScore",
    "data.awayScore"
  ], 0);
  const actorName = pickString(payload, [
    "PlayerName",
    "playerName",
    "Data.PlayerName",
    "data.playerName",
    "Data.Player",
    "data.player"
  ], "");
  const actorTeamRaw = pickString(payload, ["Team", "team", "Participant", "participant", "Data.Participant"], "");
  const actorTeam = actorTeamRaw === "2" || actorTeamRaw.toLowerCase().includes("away") ? "away" : "home";

  return {
    id: `txline:${fixtureId}:${seq}`,
    source: "txline-live",
    fixtureId,
    seq,
    txlineEventName: message.event,
    type: action === "game_finalised" ? "match_status" : classifyScoreAction(payload),
    ts: new Date().toISOString(),
    matchClock: {
      minute,
      period: period === "100" || action === "game_finalised" ? "FT" : period
    },
    teams: { home, away },
    score: { home: homeScore, away: awayScore },
    actor: actorName ? { playerName: actorName, team: actorTeam } : undefined,
    payload
  };
}

function extractOddsEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  for (const key of ["markets", "Markets", "odds", "Odds", "Prices", "prices", "data", "Data"]) {
    const value = raw[key];
    if (Array.isArray(value)) return value;
  }
  if (
    pickValue(raw, ["Decimal", "decimal", "DecimalOdds", "decimalOdds", "Price", "price", "Odds", "odds"]) !== undefined
  ) {
    return [raw];
  }
  return [];
}

function normalizeTxlineOddsEntry(entry, index, fixtureId) {
  const marketType = pickString(entry, [
    "SuperOddsType",
    "superOddsType",
    "MarketType",
    "marketType",
    "type"
  ], "market");
  const selection = pickString(entry, [
    "Selection",
    "selection",
    "Outcome",
    "outcome",
    "Participant",
    "participant",
    "Name",
    "name"
  ], `${marketType} ${index + 1}`);
  const line = pickValue(entry, ["Line", "line", "Handicap", "handicap", "Total", "total"]);
  const id = pickString(entry, ["id", "Id", "MarketId", "marketId"], [
    fixtureId,
    marketType,
    selection,
    line ?? ""
  ].join(":").replace(/[^a-z0-9:_-]/gi, "_"));
  const decimal = pickNumber(entry, [
    "Decimal",
    "decimal",
    "DecimalOdds",
    "decimalOdds",
    "Price",
    "price",
    "Odds",
    "odds"
  ], 0);

  return {
    id,
    decimal,
    sourceCount: pickNumber(entry, ["SourceCount", "sourceCount", "Books", "books"], 1),
    consensusSpreadBps: pickNumber(entry, ["ConsensusSpreadBps", "consensusSpreadBps", "SpreadBps", "spreadBps"], 0),
    volumeUsd: pickNumber(entry, ["VolumeUsd", "volumeUsd", "Volume", "volume"], 0),
    selection,
    label: pickString(entry, ["Label", "label", "MarketName", "marketName"], selection),
    type: marketType,
    line: line === undefined ? undefined : Number(line),
    raw: entry
  };
}

function normalizeTxlineOddsMessage(raw, message = {}) {
  const payload = raw && typeof raw === "object" ? raw : { value: raw };
  const seq = pickNumber(payload, ["Seq", "seq", "Sequence", "sequence"], Date.now());
  const fixtureId = pickString(payload, ["FixtureId", "fixtureId", "FixtureID", "fixture_id"], "live");
  const entries = extractOddsEntries(payload);
  const markets = entries.map((entry, index) => normalizeTxlineOddsEntry(entry, index, fixtureId));
  return {
    id: `txline-odds:${fixtureId}:${seq}:${message.id || Date.now()}`,
    source: "txline-live",
    fixtureId,
    seq,
    txlineEventName: message.event,
    type: "odds_tick",
    ts: new Date().toISOString(),
    teams: {
      home: pickString(payload, ["Participant1", "participant1", "HomeTeam", "homeTeam"], "Participant 1"),
      away: pickString(payload, ["Participant2", "participant2", "AwayTeam", "awayTeam"], "Participant 2")
    },
    score: undefined,
    payload: {
      reason: "TxODDS StablePrice update",
      markets,
      raw: payload
    }
  };
}

function normalizeTxlineStreamMessage(channel, message) {
  const data = parseSseData(message.data || "");
  if (
    data === "" ||
    data === "heartbeat" ||
    message.event === "heartbeat" ||
    message.event === "ping"
  ) {
    return {
      id: `heartbeat:${channel}:${Date.now()}`,
      source: "txline-live",
      fixtureId: "live",
      seq: Date.now(),
      txlineEventName: message.event || "heartbeat",
      type: "heartbeat",
      ts: new Date().toISOString(),
      teams: { home: "Participant 1", away: "Participant 2" },
      payload: { channel }
    };
  }
  return channel === "odds"
    ? normalizeTxlineOddsMessage(data, message)
    : normalizeTxlineScoreMessage(data, message);
}

async function listFixtures() {
  const files = await readdir(fixturesDir);
  const fixtures = [];
  for (const file of files.filter((name) => name.endsWith(".demo.json"))) {
    const fixture = JSON.parse(await readFile(path.join(fixturesDir, file), "utf8"));
    fixtures.push({
      id: fixture.id,
      file,
      metadata: fixture.metadata,
      markets: fixture.markets
    });
  }
  return fixtures.sort((a, b) => a.metadata.label.localeCompare(b.metadata.label));
}

async function loadFixture(id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, "");
  const file = path.join(fixturesDir, `${safeId}.demo.json`);
  return JSON.parse(await readFile(file, "utf8"));
}

function normalizeFixtureEvent(fixture, rawEvent, index) {
  const base = {
    id: `${fixture.id}:${rawEvent.seq ?? index + 1}`,
    source: "demo",
    fixtureId: fixture.metadata.fixtureId,
    demoFixtureId: fixture.id,
    seq: rawEvent.seq ?? index + 1,
    type: rawEvent.type,
    ts: new Date(Date.now()).toISOString(),
    matchClock: rawEvent.matchClock,
    teams: fixture.metadata.teams,
    score: rawEvent.score,
    actor: rawEvent.actor,
    payload: rawEvent.payload ?? {}
  };

  if (rawEvent.type === "market_resolved") {
    const receiptPayload = {
      fixtureId: fixture.metadata.fixtureId,
      marketId: rawEvent.payload.marketId,
      seq: rawEvent.seq ?? index + 1,
      finalScore: rawEvent.score,
      resolvedOutcome: rawEvent.payload.resolvedOutcome,
      statKeys: rawEvent.payload.statKeys
    };
    base.payload.receipt = buildSimulatedReceipt(fixture, rawEvent, receiptPayload);
  }

  return base;
}

function buildSimulatedReceipt(fixture, rawEvent, receiptPayload) {
  const targetTsMs = Date.parse(fixture.metadata.startTime) + rawEvent.offsetMs;
  const epochDay = Math.floor(targetTsMs / 86400000);
  const signedPayload = {
    provider: "TxLINE",
    network: "devnet",
    fixtureId: fixture.metadata.fixtureId,
    seq: rawEvent.seq,
    action: "game_finalised",
    statusId: 100,
    period: 100,
    score: rawEvent.score,
    resolvedOutcome: receiptPayload.resolvedOutcome
  };
  const txlinePayloadHash = hashJson(signedPayload);
  const merkleSeed = hashJson({ signedPayload, fixture: fixture.id });
  const node = (label, isRightSibling) => ({
    hash: hashJson({ merkleSeed, label }).slice(0, 66),
    isRightSibling
  });

  return {
    id: `receipt-${fixture.id}-${rawEvent.payload.marketId}`,
    fixtureId: fixture.metadata.fixtureId,
    marketId: rawEvent.payload.marketId,
    seq: rawEvent.seq,
    status: "verified",
    resolvedOutcome: receiptPayload.resolvedOutcome,
    txlinePayloadHash,
    signedPayload,
    statValidation: {
      statKeys: rawEvent.payload.statKeys,
      targetTsMs,
      epochDay,
      dailyScoresRootsPda: "7qDsvDemoScoresRootPda9LytxSABLEDevnet111",
      fixtureSummary: {
        fixtureId: fixture.metadata.fixtureId,
        updateStats: {
          updateCount: rawEvent.seq,
          minTimestamp: targetTsMs,
          maxTimestamp: targetTsMs + 180
        },
        eventsSubTreeRoot: hashJson({ fixture: fixture.id, kind: "events" }).slice(0, 66)
      },
      eventStatRoot: hashJson({ fixture: fixture.id, kind: "stats" }).slice(0, 66),
      subTreeProof: [node("subtree-0", false), node("subtree-1", true)],
      mainTreeProof: [node("main-0", true), node("main-1", false), node("main-2", true)],
      statProofs: [
        [node("home-goals-0", false), node("home-goals-1", true)],
        [node("away-goals-0", true), node("away-goals-1", false)]
      ]
    },
    solana: {
      cluster: "devnet",
      txSignature: undefined,
      explorerUrl: undefined
    },
    createdAt: new Date().toISOString()
  };
}

async function handleDemoStream(req, res, searchParams) {
  const fixtureId = searchParams.get("fixture") || "bra-arg-final";
  const speed = Math.min(Math.max(Number(searchParams.get("speed") || 5), 0.25), 20);
  const loop = searchParams.get("loop") === "1";
  const fixture = await loadFixture(fixtureId);
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  sseHeaders(res);
  writeSse(res, "reset", {
    mode: "demo",
    speed,
    fixture: {
      id: fixture.id,
      metadata: fixture.metadata,
      markets: fixture.markets
    }
  });

  do {
    let previousOffset = 0;
    for (let index = 0; index < fixture.timeline.length; index += 1) {
      if (controller.signal.aborted) return;
      const rawEvent = fixture.timeline[index];
      const waitMs = Math.max(0, (rawEvent.offsetMs - previousOffset) / speed);
      previousOffset = rawEvent.offsetMs;
      await delay(waitMs, controller.signal);
      if (controller.signal.aborted) return;
      writeSse(res, "match_event", normalizeFixtureEvent(fixture, rawEvent, index));
    }
    writeSse(res, "replay_done", {
      fixtureId: fixture.metadata.fixtureId,
      demoFixtureId: fixture.id,
      ts: new Date().toISOString()
    });
    if (loop) await delay(1500, controller.signal);
  } while (loop && !controller.signal.aborted);

  res.end();
}

async function handleLiveProxy(req, res, searchParams) {
  sseHeaders(res);
  let config;
  try {
    config = requireTxlineCredentials();
  } catch (error) {
    writeSse(res, "stream_notice", {
      status: "missing_credentials",
      message: "Set TXLINE_GUEST_JWT and TXLINE_API_TOKEN in .env, then restart the Sable server.",
      network: getTxlineConfig().network
    });
    res.end();
    return;
  }

  const requestedChannel = searchParams.get("channel") || "all";
  const channels = requestedChannel === "all"
    ? ["scores", "odds"]
    : [requestedChannel === "odds" ? "odds" : "scores"];
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  writeSse(res, "stream_notice", {
    status: "connecting",
    channel: channels.join("+"),
    network: config.network,
    apiBase: config.apiBase
  });

  await Promise.allSettled(channels.map((channel) => pipeTxlineSseChannel({
    channel,
    res,
    signal: controller.signal
  })));

  if (!res.destroyed) res.end();
}

async function pipeTxlineSseChannel({ channel, res, signal }) {
  const config = getTxlineConfig();
  const upstream = await fetch(`${config.apiBase}/${channel}/stream`, {
    signal,
    headers: getTxlineHeaders({ sse: true })
  });

  if (!upstream.ok || !upstream.body) {
    writeSse(res, "stream_notice", {
      status: "upstream_error",
      code: upstream.status,
      channel,
      message: `TxODDS ${channel} stream failed.`
    });
    return;
  }

  writeSse(res, "stream_notice", {
    status: "connected",
    channel,
    network: config.network
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.match(/\r?\n\r?\n/);
      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const message = parseSseBlock(block);
        if (message) {
          writeSse(res, "match_event", normalizeTxlineStreamMessage(channel, message), message.id);
        }
        separator = buffer.match(/\r?\n\r?\n/);
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      writeSse(res, "stream_notice", {
        status: "stream_error",
        channel,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  } finally {
    reader.releaseLock();
  }
}

async function handleProof(req, res, searchParams) {
  if (searchParams.get("source") === "txline") {
    const fixtureId = searchParams.get("fixtureId");
    const seq = searchParams.get("seq");
    const statKeys = searchParams.get("statKeys") || "1,2";
    if (!fixtureId || !seq) {
      json(res, 400, { error: "fixtureId and seq are required for TxODDS proof lookup." });
      return;
    }
    json(res, 200, await txlineJson("/scores/stat-validation", new URLSearchParams({
      fixtureId,
      seq,
      statKeys
    })));
    return;
  }

  const demoFixtureId = searchParams.get("demoFixtureId") || "bra-arg-final";
  const marketId = searchParams.get("marketId") || "BRA_ML";
  const fixture = await loadFixture(demoFixtureId);
  const resolvedEvent = fixture.timeline.find((event) =>
    event.type === "market_resolved" && event.payload?.marketId === marketId
  );

  if (!resolvedEvent) {
    json(res, 404, { error: "No receipt is available for that market in this fixture." });
    return;
  }

  const normalized = normalizeFixtureEvent(fixture, resolvedEvent, fixture.timeline.indexOf(resolvedEvent));
  json(res, 200, normalized.payload.receipt);
}

async function handleSettlement(req, res) {
  const body = await readRequestBody(req);
  const marketId = String(body.marketId || "UNKNOWN");
  const userWallet = String(body.userWallet || "DemoWallet111111111111111111111111111111111");
  const txSignature = fakeBase58("4sbl");
  const escrowPda = fakeBase58("Esc");
  const vaultPda = fakeBase58("Vlt");
  const explorerUrl = `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;

  json(res, 200, {
    id: `escrow-${marketId}`,
    userWallet,
    marketId,
    selection: body.selection || "resolved_selection",
    amountUsdc: body.amountUsdc || "100.00",
    status: "settled",
    escrowPda,
    vaultPda,
    settleTx: txSignature,
    txSignature,
    explorerUrl,
    validation: {
      program: process.env.TXLINE_DEVNET_PROGRAM_ID || "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
      instruction: "validateStatV2",
      result: "passed"
    }
  });
}

async function handleTxlineStatus(req, res) {
  const config = getTxlineConfig();
  json(res, 200, {
    network: config.network,
    apiBase: config.apiBase,
    guestAuth: config.guestAuth,
    programId: config.programId,
    hasGuestJwt: Boolean(config.jwt),
    hasApiToken: Boolean(config.apiToken),
    liveReady: config.hasCredentials
  });
}

async function handleTxlineFixtures(req, res, searchParams) {
  json(res, 200, await txlineJson("/fixtures/snapshot", searchParams));
}

async function handleTxlineOdds(req, res, fixtureId) {
  json(res, 200, await txlineJson(`/odds/snapshot/${encodeURIComponent(fixtureId)}`));
}

async function handleTxlineScores(req, res, fixtureId) {
  json(res, 200, await txlineJson(`/scores/snapshot/${encodeURIComponent(fixtureId)}`));
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    text(res, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    text(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/api/health") {
      json(res, 200, { ok: true, name: "Sable", ts: new Date().toISOString() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/txline/status") {
      await handleTxlineStatus(req, res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/txline/fixtures") {
      await handleTxlineFixtures(req, res, url.searchParams);
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/txline/odds/")) {
      await handleTxlineOdds(req, res, decodeURIComponent(path.basename(pathname)));
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/txline/scores/")) {
      await handleTxlineScores(req, res, decodeURIComponent(path.basename(pathname)));
      return;
    }

    if (req.method === "GET" && pathname === "/api/fixtures") {
      json(res, 200, await listFixtures());
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/api/fixtures/")) {
      json(res, 200, await loadFixture(path.basename(pathname)));
      return;
    }

    if (req.method === "GET" && pathname === "/api/sim/stream") {
      await handleDemoStream(req, res, url.searchParams);
      return;
    }

    if (req.method === "GET" && pathname === "/api/stream") {
      await handleLiveProxy(req, res, url.searchParams);
      return;
    }

    if (req.method === "GET" && pathname === "/api/proofs/stat") {
      await handleProof(req, res, url.searchParams);
      return;
    }

    if (req.method === "POST" && pathname === "/api/settlement/simulate") {
      await handleSettlement(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res, pathname);
      return;
    }

    text(res, 405, "Method not allowed");
  } catch (error) {
    json(res, error.status || 500, error.publicDetails || {
      error: "Internal server error",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, () => {
  console.log(`Sable terminal running at http://localhost:${port}`);
});
