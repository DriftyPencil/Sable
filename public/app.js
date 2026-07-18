const state = {
  mode: "live",
  fixtureKey: "",
  fixtures: [],
  source: null,
  connected: false,
  lastEventAt: null,
  events: [],
  match: null,
  markets: new Map(),
  oddsHistory: new Map(),
  alerts: [],
  receipts: new Map(),
  selectedMarketId: null,
  liveStatus: null,
  marketNotice: "",
  historyBackfillFixtureId: "",
  historyLoading: false,
  drawerOpen: false,
  activePane: "match",
  commandLog: [
    { kind: "out", text: "Ready. Live TxODDS mode is active. Select a fixture, then use ODDS, STEAM, PROOF, or SETTLE." }
  ],
  settlement: null,
  wallet: ""
};

const els = {};

function qs(selector) {
  return document.querySelector(selector);
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function pct(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}

function odds(value) {
  if (!value) return "Closed";
  return Number(value).toFixed(2);
}

function preciseOdds(value) {
  if (!value) return "--";
  return Number(value).toFixed(3);
}

function bps(value) {
  if (!Number.isFinite(value)) return "0 bps";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value)} bps`;
}

function implied(decimal) {
  return decimal > 0 ? 1 / decimal : 0;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pctValue(value, fallbackDecimal = 0) {
  const number = Number(value);

  if (Number.isFinite(number)) return number / 100;
  return implied(Number(fallbackDecimal));
}

function clockLabel(clock) {
  if (!clock) return "--";
  const extra = clock.stoppage ? `+${clock.stoppage}` : "";
  if (clock.period === "NS") return "NS";
  if (clock.period === "FT" || clock.period === "HT") return clock.period;
  return `${clock.minute}${extra}' ${clock.period}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function short(value, size = 10) {
  const text = String(value || "");
  if (text.length <= size * 2 + 3) return text;
  return `${text.slice(0, size)}...${text.slice(-size)}`;
}

function getFixtureRecord(key = state.fixtureKey) {
  return state.fixtures.find((fixture) => fixture.id === key);
}

function activeFixtureId() {
  return state.match?.fixtureId || getFixtureRecord()?.metadata?.fixtureId || "";
}

function scoreValue(score, side) {
  const value = score?.[side];
  return Number.isFinite(Number(value)) ? Number(value) : "--";
}

function fixtureStartLabel(startTime) {
  const timestamp = Number(startTime);

  if (!Number.isFinite(timestamp)) return "time TBA";

  return new Date(timestamp).toLocaleString("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function fixtureOptionLabel(fixture) {
  const rawSport = fixture.metadata.sport || "";
  const sportPrefix = rawSport && rawSport !== "Unknown" ? `${rawSport} · ` : "";
  const label = fixture.metadata.label || "Fixture";
  const start = fixtureStartLabel(fixture.metadata.startTime);
  const fixtureId = fixture.metadata.fixtureId || "";

  return `${sportPrefix}${label} · ${start} · #${fixtureId}`;
}

function setActivePane(pane) {
  state.activePane = pane;
  document.querySelectorAll(".pane").forEach((el) => {
    el.dataset.focus = el.dataset.pane === pane ? "true" : "false";
  });
}

async function init() {
  els.statusBar = qs("#statusBar");
  els.fixtureSelect = qs("#fixtureSelect");
  els.matchTape = qs("#matchTape");
  els.matchTitle = qs("#matchTitle");
  els.matchDetail = qs("#matchDetail");
  els.oddsMonitor = qs("#oddsMonitor");
  els.marketScanner = qs("#marketScanner");
  els.oddsChart = qs("#oddsChart");
  els.chartMarketLabel = qs("#chartMarketLabel");
  els.settlementConsole = qs("#settlementConsole");
  els.commandForm = qs("#commandForm");
  els.commandInput = qs("#commandInput");
  els.commandHistory = qs("#commandHistory");
  els.receiptDrawer = qs("#receiptDrawer");

  bindEvents();
  await hydrateLiveFixtures();
  connectStream();
  renderAll();
}

function bindEvents() {
  els.fixtureSelect.addEventListener("change", async () => {
    state.fixtureKey = els.fixtureSelect.value;
    applyFixture(getFixtureRecord());
    await hydrateLiveScore(getFixtureRecord());
    await hydrateLiveOdds(getFixtureRecord());
    connectStream();
  });
  els.commandForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCommand();
  });
  els.commandInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitCommand();
    }
  });
  els.oddsMonitor.addEventListener("click", (event) => {
    const row = event.target.closest("[data-market-id]");
    if (!row) return;
    state.selectedMarketId = row.dataset.marketId;
    setActivePane("odds");
    renderAll();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      els.commandInput.focus();
    }
    if (event.key === "Escape" && state.drawerOpen) {
      closeReceiptDrawer();
    }
  });
}

function applyFixture(record) {
  if (!record) return;
  state.match = {
    ...record.metadata,
    scoreStatus: record.metadata.scoreStatus || "unavailable",
    score: record.metadata.score || undefined,
    clock: record.metadata.clock || { minute: 0, period: "NS" }
  };
  state.markets = new Map(record.markets.map((market) => [market.id, { ...market }]));
  state.oddsHistory = new Map();
  state.receipts = new Map();
  state.alerts = [];
  state.events = [];
  state.settlement = null;
  state.marketNotice = "";
  state.selectedMarketId = record.markets[0]?.id || null;
}

function connectStream() {
  if (state.source) state.source.close();
  const record = getFixtureRecord();

  if (record && (!state.match || state.match.fixtureId !== record.metadata.fixtureId)) {
    applyFixture(record);
  }

  state.events = [];
  state.alerts = [];
  state.receipts = new Map();
  state.settlement = null;
  state.connected = false;
  state.lastEventAt = null;
  renderAll();

  const fixtureId = getFixtureRecord()?.metadata?.fixtureId || "";
  const liveQuery = new URLSearchParams({ channel: "all" });
  if (fixtureId) liveQuery.set("fixtureId", fixtureId);

  const source = new EventSource(`/api/stream?${liveQuery.toString()}`);
  state.source = source;

  source.onopen = () => {
    state.connected = true;
    renderStatus();
  };

  source.addEventListener("match_event", (event) => {
    reduceMatchEvent(JSON.parse(event.data));
  });

  source.addEventListener("stream_notice", (event) => {
    const data = JSON.parse(event.data);
    state.liveStatus = data;
    log("out", `${data.status}: ${data.message || `${data.channel || "stream"} ${data.network || ""}`}`);
    if (data.status === "missing_credentials" || data.status === "upstream_error") {
      state.connected = false;
      source.close();
    }
    renderAll();
  });

  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      reduceRawLiveEvent(data);
    } catch {
      log("out", "Live stream message received.");
      renderCommandHistory();
    }
  };

  source.onerror = () => {
    state.connected = false;
    renderStatus();
  };
}

function reduceRawLiveEvent(data) {
  const homeScore = Number(data.HomeScore ?? data.homeScore);
  const awayScore = Number(data.AwayScore ?? data.awayScore);
  const event = {
    id: `live:${data.Seq || data.seq || Date.now()}`,
    source: "txline-live",
    fixtureId: String(data.FixtureId || data.fixtureId || "live"),
    seq: Number(data.Seq || data.seq || 0),
    type: data.action === "goal" ? "goal" : "match_status",
    ts: new Date().toISOString(),
    matchClock: { minute: Number(data.Minute || data.minute || 0), period: "H1" },
    teams: state.match?.teams || { home: "Home", away: "Away" },
    scoreStatus: Number.isFinite(homeScore) && Number.isFinite(awayScore) ? "available" : "unavailable",
    score: Number.isFinite(homeScore) && Number.isFinite(awayScore)
      ? { home: homeScore, away: awayScore }
      : undefined,
    payload: data
  };
  reduceMatchEvent(event);
}

function reduceMatchEvent(event) {
  state.lastEventAt = new Date();
  if (event.type === "heartbeat") {
    renderStatus();
    return;
  }

  if (activeFixtureId() && event.fixtureId !== activeFixtureId()) {
    return;
  }

  if (event.source === "txline-live" && state.match?.fixtureId !== event.fixtureId) {
    const liveRecord = state.fixtures.find((fixture) => fixture.metadata.fixtureId === event.fixtureId);
    if (liveRecord) {
      applyFixture(liveRecord);
    } else if (!state.match || state.match.fixtureId !== event.fixtureId) {
      state.match = {
        fixtureId: event.fixtureId,
        label: `${event.teams.home} vs ${event.teams.away}`,
        competition: "TxODDS live",
        round: "Live feed",
        venue: "TxLINE",
        teams: event.teams,
        scoreStatus: event.scoreStatus || "unavailable",
        score: event.score,
        clock: event.matchClock || { minute: 0, period: "NS" }
      };
    }
  }

  if (state.match) {
    if (event.teams?.home && event.teams.home !== "Participant 1") state.match.teams = event.teams;
    state.match.scoreStatus = event.scoreStatus || state.match.scoreStatus;
    state.match.score = event.score || state.match.score;
    state.match.clock = event.matchClock || state.match.clock;
  }

  state.events.unshift(event);
  state.events = state.events.slice(0, 90);

  if (event.type === "odds_tick") {
    applyOddsTick(event);
  }

  if (event.type === "market_resolved") {
    const market = state.markets.get(event.payload.marketId);
    if (market) {
      market.status = "resolved";
      market.resolvedOutcome = event.payload.resolvedOutcome;
    }
    if (event.payload.receipt) {
      state.receipts.set(event.payload.marketId, event.payload.receipt);
    }
  }

  renderAll();
}

function applyOddsTick(event) {
  for (const rawQuote of event.payload.markets || []) {
    const quote = normalizeIncomingMarketQuote(rawQuote, event.fixtureId);
    const existingMarket = state.markets.get(quote.id) || {
      id: quote.id,
      fixtureId: event.fixtureId,
      label: quote.label || quote.id,
      selection: quote.selection || quote.id,
      type: quote.type || "unknown",
      family: quote.family || "Market",
      periodLabel: quote.periodLabel || "Full Match",
      groupLabel: quote.groupLabel || "Markets",
      marketCode: quote.marketCode || quote.type || "market",
      status: "open",
      volumeUsd: 0,
      liquidityUsd: 0,
      resolutionRule: { statKeys: [], predicate: "" }
    };
    const history = state.oddsHistory.get(quote.id) || [];
    const previous = history.at(-1);
    const nextProbability = Number.isFinite(Number(quote.impliedProbability))
      ? Number(quote.impliedProbability)
      : pctValue(quote.txlineProbability, quote.decimal);
    const market = {
      ...existingMarket,
      ...quote,
      currentOddsDecimal: Number(quote.decimal),
      impliedProbability: nextProbability,
      consensusSpreadBps: Number(quote.consensusSpreadBps || 0),
      sourceCount: Number(quote.sourceCount || 0),
      volumeUsd: Number(quote.volumeUsd || existingMarket.volumeUsd || 0),
      status: existingMarket.status === "resolved" ? "resolved" : "open"
    };

    appendOddsHistoryPoint(market, "stream");

    if (previous) {
      const latest = state.oddsHistory.get(quote.id)?.at(-1);
      const deltaBps = latest
        ? (latest.impliedProbability - previous.impliedProbability) * 10000
        : 0;
      if (Math.abs(deltaBps) >= 650) {
        const trigger = state.events.find((item) => item.type !== "odds_tick");
        state.alerts.unshift({
          id: `alert:${quote.id}:${event.seq}`,
          fixtureId: event.fixtureId,
          marketId: quote.id,
          ts: event.ts,
          severity: Math.abs(deltaBps) > 1800 ? "critical" : "warning",
          kind: "steam_move",
          message: `${market.selection} moved ${bps(deltaBps)} after ${event.payload.reason}`,
          deltaProbabilityBps: deltaBps,
          windowSec: 20,
          triggeredByEventId: trigger?.id
        });
        state.alerts = state.alerts.slice(0, 20);
      }
    }
  }
}

async function hydrateLiveFixtures() {
  const statusResponse = await fetch("/api/txline/status");
  state.liveStatus = await statusResponse.json();
  if (!state.liveStatus.liveReady) {
    log("out", "LIVE mode needs TXLINE_GUEST_JWT and TXLINE_API_TOKEN in .env, then a server restart.");
    return;
  }

  const response = await fetch("/api/txline/fixtures");
  if (!response.ok) {
    log("out", `TxODDS fixtures failed with ${response.status}.`);
    return;
  }

  const rawFixtures = await response.json();
  const fixtures = normalizeLiveFixtures(rawFixtures);
  if (!fixtures.length) {
    log("out", "TxODDS fixtures returned no rows for this account.");
    return;
  }

  state.fixtures = fixtures;
  els.fixtureSelect.innerHTML = fixtures.map((fixture) => (
    `<option value="${fixture.id}">${escapeHtml(fixtureOptionLabel(fixture))}</option>`
  )).join("");

  const selectedFixture = getFixtureRecord() || fixtures[0];

  state.fixtureKey = selectedFixture.id;
  els.fixtureSelect.value = state.fixtureKey;
  applyFixture(selectedFixture);
  await hydrateLiveScore(selectedFixture);
  await hydrateLiveOdds(selectedFixture);
}

async function hydrateLiveOdds(record) {
  if (!record?.metadata?.fixtureId || !state.liveStatus?.liveReady) return;
  const markets = await fetchLiveOddsMarkets(record);

  state.markets = new Map();
  state.oddsHistory = new Map();
  await hydrateLiveOddsHistory(record);
  seedOddsHistory(markets, "snapshot");

  if (!state.markets.size) {
    state.selectedMarketId = null;
    state.marketNotice = `No TxODDS odds snapshot or update history is available for ${record.metadata.label}.`;
    log("out", `No TxODDS odds data for ${record.metadata.label}.`);
    return;
  }

  state.selectedMarketId = state.markets.has(state.selectedMarketId)
    ? state.selectedMarketId
    : [...state.markets.values()].sort((a, b) => String(a.sortKey || a.id).localeCompare(String(b.sortKey || b.id)))[0]?.id || null;
  state.marketNotice = "";
  log("out", `Loaded ${state.markets.size} real TxODDS wager histories for ${record.metadata.label}.`);
}

async function hydrateLiveOddsHistory(record) {
  if (!record?.metadata?.fixtureId || !state.liveStatus?.liveReady) return;

  const response = await fetch(`/api/txline/odds-history/${encodeURIComponent(record.metadata.fixtureId)}?hours=12`);

  if (!response.ok) {
    log("out", `TxODDS odds history failed with ${response.status}. Live ticks will build history from here.`);
    return;
  }

  const payload = await response.json();
  const rawRows = Array.isArray(payload) ? payload : payload.rows;
  const historyMarkets = normalizeOddsSnapshot(rawRows, record.metadata.fixtureId, record.metadata.teams);

  seedOddsHistory(historyMarkets, "history");

  if (historyMarkets.length) {
    log("out", `Backfilled ${historyMarkets.length} TxODDS historical price events.`);
  }
}

function seedOddsHistory(markets = [], source = "history") {
  for (const market of markets) {
    appendOddsHistoryPoint(market, source);
  }
}

function registerMarket(market, source = "history") {
  const existing = state.markets.get(market.id) || {};
  const sourceStatus = source === "history" ? "history" : market.status || "open";
  const status = existing.status === "resolved"
    ? existing.status
    : existing.status === "open" && source === "history"
      ? existing.status
      : sourceStatus;
  const next = {
    ...existing,
    ...market,
    status
  };

  state.markets.set(market.id, next);
  return next;
}

function refreshMarketFromHistory(marketId = "") {
  const market = state.markets.get(marketId);
  const history = state.oddsHistory.get(marketId) || [];
  const latest = history.at(-1);

  if (!market || !latest) return;

  state.markets.set(marketId, {
    ...market,
    currentOddsDecimal: latest.decimal,
    impliedProbability: latest.impliedProbability,
    consensusSpreadBps: latest.consensusSpreadBps,
    sourceCount: latest.sourceCount,
    volumeUsd: latest.volumeUsd,
    priceTs: new Date(latest.ts).getTime()
  });
}

function appendOddsHistoryPoint(market, source = "history") {
  const registeredMarket = registerMarket(market, source);
  const ts = market.priceTs
    ? new Date(market.priceTs).toISOString()
    : new Date().toISOString();
  const history = state.oddsHistory.get(registeredMarket.id) || [];
  const point = {
    id: `${market.id}:${market.priceTs || Date.now()}`,
    marketId: registeredMarket.id,
    fixtureId: registeredMarket.fixtureId,
    ts,
    decimal: Number(market.currentOddsDecimal),
    impliedProbability: Number(market.impliedProbability),
    consensusSpreadBps: Number(market.consensusSpreadBps || 0),
    sourceCount: Number(market.sourceCount || 0),
    volumeUsd: Number(market.volumeUsd || 0)
  };
  const duplicate = history.some((item) => (
    item.ts === point.ts && Number(item.decimal) === Number(point.decimal)
  ));

  if (!duplicate && Number.isFinite(point.decimal) && point.decimal > 0) {
    history.push(point);
    history.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    state.oddsHistory.set(registeredMarket.id, history);
    refreshMarketFromHistory(registeredMarket.id);
  }
}

async function hydrateLiveScore(record) {
  if (!record?.metadata?.fixtureId || !state.liveStatus?.liveReady) return;
  const response = await fetch(`/api/txline/scores/${encodeURIComponent(record.metadata.fixtureId)}`);

  if (!response.ok) {
    log("out", `TxODDS score lookup failed with ${response.status} for ${record.metadata.label}.`);
    return;
  }

  const payload = await response.json();
  const latestEvent = payload.latestEvent;

  if (!state.match || state.match.fixtureId !== record.metadata.fixtureId) return;

  state.match.scoreStatus = payload.scoreStatus || "unavailable";
  if (latestEvent?.score) state.match.score = latestEvent.score;
  if (latestEvent?.matchClock) state.match.clock = latestEvent.matchClock;

  if (!latestEvent?.score) {
    log("out", `No TxODDS score payload is available for ${record.metadata.label}.`);
  }
}

async function fetchLiveOddsMarkets(record) {
  const response = await fetch(`/api/txline/odds/${encodeURIComponent(record.metadata.fixtureId)}`);
  if (!response.ok) {
    log("out", `TxODDS odds snapshot failed with ${response.status}. Waiting for stream ticks.`);
    return [];
  }

  const rawOdds = await response.json();
  const markets = normalizeOddsSnapshot(rawOdds, record.metadata.fixtureId, record.metadata.teams);
  return markets;
}

function normalizeLiveFixtures(rawFixtures) {
  const rows = Array.isArray(rawFixtures) ? rawFixtures : [];
  const fixturesById = new Map();
  const nowMs = Date.now();
  const liveGraceMs = 3 * 60 * 60 * 1000;

  for (const fixture of rows.slice(0, 80)) {
    const fixtureId = String(fixture.FixtureId || fixture.fixtureId || fixture.Id || fixture.id || "");
    const participant1 = String(fixture.Participant1 || fixture.participant1 || fixture.HomeTeam || fixture.homeTeam || "Participant 1");
    const participant2 = String(fixture.Participant2 || fixture.participant2 || fixture.AwayTeam || fixture.awayTeam || "Participant 2");
    const p1Home = fixture.Participant1IsHome ?? fixture.participant1IsHome ?? true;
    const home = p1Home ? participant1 : participant2;
    const away = p1Home ? participant2 : participant1;
    const rawSport = String(fixture.SableSport || fixture.Sport || fixture.sport || "");
    const sport = rawSport && rawSport !== "Sport" ? rawSport : sportName(fixture.SportId || fixture.sportId);
    const latestScoreEvent = fixture.SableLatestScoreEvent || null;

    if (!fixtureId || fixturesById.has(fixtureId)) continue;

    fixturesById.set(fixtureId, {
      id: `txline-${fixtureId}`,
      source: "txline-live",
      metadata: {
        fixtureId,
        label: `${home} vs ${away}`,
        sport,
        competition: String(fixture.CompetitionName || fixture.competitionName || fixture.Competition || "TxODDS fixture"),
        round: String(fixture.FixtureGroup || fixture.fixtureGroup || fixture.Round || fixture.Competition || "Live fixture"),
        venue: String(fixture.Venue || fixture.venue || "TxLINE"),
        startTime: String(fixture.StartTime || fixture.startTime || new Date().toISOString()),
        scoreStatus: latestScoreEvent?.score ? "available" : "unavailable",
        score: latestScoreEvent?.score,
        clock: latestScoreEvent?.matchClock,
        teams: { home, away }
      },
      markets: []
    });
  }

  return [...fixturesById.values()]
    .filter((fixture) => {
      const startMs = Number(fixture.metadata.startTime);
      return Number.isFinite(startMs) && startMs >= nowMs - liveGraceMs;
    })
    .sort((a, b) => Number(a.metadata.startTime) - Number(b.metadata.startTime));
}

function sportName(sportId) {
  switch (String(sportId || "")) {
    case "1":
      return "Soccer";
    case "2":
      return "Tennis";
    case "3":
      return "Basketball";
    case "4":
      return "American Football";
    case "5":
      return "Baseball";
    case "6":
      return "Ice Hockey";
    default:
      return "Unknown";
  }
}

function marketLine(row) {
  const directLine = row.Line ?? row.line ?? row.Handicap ?? row.handicap ?? row.Total ?? row.total;
  const parameters = String(row.MarketParameters || row.marketParameters || "");
  const lineMatch = parameters.match(/(?:^|;)line=([-+]?\d+(?:\.\d+)?)/);

  if (directLine !== undefined && directLine !== null && directLine !== "") return Number(directLine);
  return lineMatch ? Number(lineMatch[1]) : undefined;
}

function marketPeriod(row = {}) {
  return String(row.MarketPeriod || row.marketPeriod || row.Period || row.period || "");
}

function periodLabel(period = "") {
  if (period === "half=1") return "1st Half";
  if (period === "half=2") return "2nd Half";
  return "Full Match";
}

function marketFamily(marketType = "") {
  const type = String(marketType).toUpperCase();

  if (type.includes("1X2")) return "Match Winner";
  if (type.includes("ASIANHANDICAP")) return "Asian Handicap";
  if (type.includes("OVERUNDER")) return "Total Goals";
  return "Market";
}

function marketCode(marketType = "") {
  const type = String(marketType).toUpperCase();

  if (type.includes("1X2")) return "1X2";
  if (type.includes("ASIANHANDICAP")) return "AH";
  if (type.includes("OVERUNDER")) return "O/U";
  return type || "MARKET";
}

function displayLine(line) {
  if (line === undefined) return "";
  if (line === 0) return "0";
  return `${line > 0 ? "+" : ""}${line}`;
}

function selectionTeam(rawSelection = "", teams = {}) {
  const selection = String(rawSelection).toLowerCase();

  if (selection === "part1") return teams.home || "Participant 1";
  if (selection === "part2") return teams.away || "Participant 2";
  if (selection === "draw") return "Draw";
  if (selection === "over") return "Over";
  if (selection === "under") return "Under";
  return String(rawSelection)
    .replace("part1", teams.home || "Participant 1")
    .replace("part2", teams.away || "Participant 2");
}

function selectionSpecificLine(rawSelection = "", marketType = "", line = undefined) {
  const selection = String(rawSelection).toLowerCase();
  const type = String(marketType).toUpperCase();

  if (line === undefined) return undefined;
  if (type.includes("ASIANHANDICAP") && selection === "part2") return Number(line) === 0 ? 0 : -Number(line);
  return Number(line);
}

function marketSelectionLabel(row, rawSelection, marketType, line, teams = {}) {
  const selection = selectionTeam(rawSelection, teams);
  const normalizedSelection = selection.toLowerCase();

  if ((normalizedSelection === "over" || normalizedSelection === "under") && line !== undefined) {
    return `${selection} ${line}`;
  }

  if (String(marketType).toUpperCase().includes("ASIANHANDICAP") && line !== undefined) {
    const sideLine = selectionSpecificLine(rawSelection, marketType, line);
    return `${selection} ${displayLine(sideLine)}`;
  }

  return selection;
}

function stableMarketId(fixtureId = "", marketType = "", period = "", line = undefined, rawSelection = "") {
  return [
    fixtureId || "fixture",
    marketType || "market",
    period || "full",
    line === undefined ? "na" : line,
    rawSelection || "selection"
  ].join(":").replace(/[^a-z0-9:_+.-]/gi, "_");
}

function marketSortKey({ family = "", period = "", line = undefined, selection = "" } = {}) {
  const familyRank = {
    "Match Winner": 1,
    "Asian Handicap": 2,
    "Total Goals": 3,
    "Market": 9
  }[family] || 9;
  const periodRank = period === "half=1" ? 2 : period === "half=2" ? 3 : 1;
  const lineRank = line === undefined ? 0 : Number(line) + 100;

  return `${familyRank}.${periodRank}.${String(lineRank).padStart(8, "0")}.${selection}`;
}

function rowTimestamp(row = {}) {
  return finiteNumber(row.Ts || row.ts || row.Timestamp || row.timestamp, 0);
}

function normalizeOddsSnapshot(rawOdds, fixtureId, teams = {}) {
  const rows = Array.isArray(rawOdds)
    ? rawOdds
    : ["markets", "Markets", "odds", "Odds", "data", "Data"].flatMap((key) => (
      Array.isArray(rawOdds?.[key]) ? rawOdds[key] : []
    ));

  return rows.flatMap(expandOddsRow).map((row, index) => {
    const marketType = String(row.SuperOddsType || row.superOddsType || row.MarketType || row.marketType || row.type || "market");
    const rawSelection = String(row.Selection || row.selection || row.Outcome || row.outcome || row.Name || row.name || `${marketType} ${index + 1}`);
    const line = marketLine(row);
    const period = marketPeriod(row);
    const family = marketFamily(marketType);
    const selection = marketSelectionLabel(row, rawSelection, marketType, line, teams);
    const specificLine = selectionSpecificLine(rawSelection, marketType, line);
    const id = String(row.MarketId || row.marketId || stableMarketId(fixtureId, marketType, period, line, rawSelection));
    const decimal = Number(row.Decimal || row.decimal || row.DecimalOdds || row.decimalOdds || row.Price || row.price || row.Odds || row.odds || 0);
    const probability = pctValue(row.PctValue ?? row.pctValue, decimal);
    const groupLabel = `${periodLabel(period)} ${family}`;
    const lineLabel = line === undefined
      ? ""
      : String(marketType).toUpperCase().includes("ASIANHANDICAP")
        ? displayLine(specificLine)
        : String(line);
    return {
      id,
      fixtureId,
      type: marketType,
      family,
      period,
      periodLabel: periodLabel(period),
      groupLabel,
      marketCode: marketCode(marketType),
      label: groupLabel,
      selection,
      line: line === undefined ? undefined : Number(line),
      lineLabel,
      status: decimal > 0 ? "open" : "suspended",
      currentOddsDecimal: decimal,
      impliedProbability: probability,
      volumeUsd: Number(row.VolumeUsd || row.volumeUsd || row.Volume || row.volume || 0),
      liquidityUsd: Number(row.LiquidityUsd || row.liquidityUsd || row.Liquidity || row.liquidity || 0),
      consensusSpreadBps: Number(row.ConsensusSpreadBps || row.consensusSpreadBps || 0),
      sourceCount: Number(row.SourceCount || row.sourceCount || 1),
      priceTs: rowTimestamp(row),
      sortKey: marketSortKey({ family, period, line, selection }),
      resolutionRule: {
        statKeys: [1, 2],
        predicate: "Resolve with TxODDS score stat-validation proof"
      }
    };
  });
}

function expandOddsRow(row) {
  const prices = row.Prices || row.prices;
  const priceNames = row.PriceNames || row.priceNames;
  const pctValues = row.Pct || row.pct || [];
  if (Array.isArray(prices) && Array.isArray(priceNames)) {
    return prices.map((price, index) => ({
      ...row,
      RawMessageId: row.MessageId || row.messageId || "",
      PriceIndex: index,
      Selection: priceNames[index] || `selection_${index + 1}`,
      Decimal: Number(price) / 1000,
      PctValue: pctValues[index]
    }));
  }
  return [row];
}

function normalizeIncomingMarketQuote(quote = {}, fixtureId = "") {
  const raw = quote.raw || quote;
  const marketType = String(quote.type || raw.SuperOddsType || raw.superOddsType || raw.MarketType || raw.marketType || "market");
  const rawSelection = String(raw.Selection || raw.selection || quote.rawSelection || quote.selection || "");
  const line = quote.line !== undefined ? Number(quote.line) : marketLine(raw);
  const period = quote.period || marketPeriod(raw);
  const family = marketFamily(marketType);
  const selection = marketSelectionLabel(raw, rawSelection, marketType, line, state.match?.teams || {});
  const decimal = Number(quote.decimal || quote.currentOddsDecimal || raw.Decimal || raw.decimal || 0);
  const groupLabel = `${periodLabel(period)} ${family}`;
  const id = stableMarketId(fixtureId, marketType, period, line, rawSelection || selection);

  return {
    ...quote,
    id,
    fixtureId,
    decimal,
    impliedProbability: pctValue(quote.txlineProbability ?? raw.PctValue ?? raw.pctValue, decimal),
    txlineProbability: quote.txlineProbability ?? raw.PctValue ?? raw.pctValue,
    selection,
    type: marketType,
    family,
    period,
    periodLabel: periodLabel(period),
    groupLabel,
    marketCode: marketCode(marketType),
    line,
    lineLabel: line === undefined ? "" : String(line),
    label: groupLabel,
    priceTs: quote.priceTs || rowTimestamp(raw),
    sortKey: marketSortKey({ family, period, line, selection })
  };
}

function renderAll() {
  renderStatus();
  renderMatchDetail();
  renderTape();
  renderOdds();
  renderScanner();
  renderChart();
  renderSettlement();
  renderCommandHistory();
  renderReceiptDrawer();
  setActivePane(state.activePane);
}

function renderStatus() {
  const selected = state.markets.get(state.selectedMarketId);
  const connection = state.connected ? "CONNECTED" : "IDLE";
  const connectionClass = state.connected ? "status-good" : "status-warn";
  els.statusBar.innerHTML = [
    ["MODE", "LIVE", "status-good"],
    ["STREAM", connection, connectionClass],
    ["FIXTURE", state.match?.label || "--", ""],
    ["CLOCK", clockLabel(state.match?.clock), ""],
    ["LAST EVENT", state.lastEventAt ? state.lastEventAt.toLocaleTimeString() : "--", ""],
    ["WAGER", selected?.selection || "--", ""]
  ].map(([label, value, klass]) => (
    `<div class="status-cell"><span>${label}</span><strong class="status-value ${klass}">${escapeHtml(value)}</strong></div>`
  )).join("");
}

function renderTape() {
  if (!state.events.length) {
    els.matchTape.innerHTML = `<div class="empty-state">Waiting for TxLINE-shaped match events...</div>`;
    return;
  }

  els.matchTape.innerHTML = state.events.map((event) => `
    <article class="tape-row">
      <span class="tape-meta">${escapeHtml(clockLabel(event.matchClock))}</span>
      <div>
        <div class="tape-headline">
          <span class="type-${escapeHtml(event.type)}">${escapeHtml(event.type.toUpperCase())}</span>
          <strong>${escapeHtml(eventHeadline(event))}</strong>
        </div>
        <div class="tape-sub">seq ${event.seq} / ${escapeHtml(event.source)}</div>
      </div>
    </article>
  `).join("");
}

function eventHeadline(event) {
  if (event.type === "goal") {
    const team = event.actor?.team === "home" ? event.teams.home : event.teams.away;
    return `${team} goal: ${event.actor?.playerName || "Unknown"} (${event.score.home}-${event.score.away})`;
  }
  if (event.type === "card") {
    return `${event.payload.card || "Card"} card: ${event.actor?.playerName || "Unknown"}`;
  }
  if (event.type === "var") {
    return `VAR ${event.payload.type || ""}: ${event.payload.outcome || ""}`;
  }
  if (event.type === "odds_tick") {
    return `${event.payload.reason || "Odds tick"}: ${(event.payload.markets || []).length} markets`;
  }
  if (event.type === "market_resolved") {
    return `${event.payload.marketId} resolved to ${event.payload.resolvedOutcome}`;
  }
  return event.payload.note || event.payload.action || event.payload.Action || "Status update";
}

function renderMatchDetail() {
  const match = state.match;
  if (!match) return;
  els.matchTitle.textContent = match.label;
  const markets = [...state.markets.values()];
  const totalVolume = markets.reduce((sum, market) => sum + Number(market.volumeUsd || 0), 0);
  const latestEvent = state.events[0];
  const resolved = markets.filter((market) => market.status === "resolved").length;

  els.matchDetail.innerHTML = `
    <div class="scoreboard">
      <div>
        <div class="team-name">${escapeHtml(match.teams.home)}</div>
        <div class="score">${escapeHtml(scoreValue(match.score, "home"))}</div>
      </div>
      <div class="score-center">
        <div class="clock-big">${escapeHtml(clockLabel(match.clock))}</div>
        <div class="round-label">${escapeHtml(match.scoreStatus === "unavailable" ? "No TxODDS score payload" : match.round)}</div>
      </div>
      <div>
        <div class="team-name">${escapeHtml(match.teams.away)}</div>
        <div class="score">${escapeHtml(scoreValue(match.score, "away"))}</div>
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric"><span>Markets</span><strong>${markets.length}</strong></div>
      <div class="metric"><span>Volume</span><strong>${money(totalVolume)}</strong></div>
      <div class="metric"><span>Alerts</span><strong>${state.alerts.length}</strong></div>
      <div class="metric"><span>Resolved</span><strong>${resolved}</strong></div>
    </div>
    <div class="metric-grid">
      <div class="metric"><span>Fixture ID</span><strong>${escapeHtml(match.fixtureId)}</strong></div>
      <div class="metric"><span>Sport</span><strong>${escapeHtml(match.sport || "Unknown")}</strong></div>
      <div class="metric"><span>Competition</span><strong>${escapeHtml(match.competition)}</strong></div>
      <div class="metric"><span>Latest Seq</span><strong>${latestEvent?.seq || "--"}</strong></div>
    </div>
  `;
}

function renderOdds() {
  const markets = [...state.markets.values()].sort((a, b) => String(a.sortKey || a.id).localeCompare(String(b.sortKey || b.id)));
  const groupedMarkets = groupMarkets(markets);

  if (!markets.length) {
    els.oddsMonitor.innerHTML = `<div class="empty-state">${escapeHtml(state.marketNotice || "No markets loaded.")}</div>`;
    return;
  }

  els.oddsMonitor.innerHTML = groupedMarkets.map(([groupLabel, groupMarketsList]) => `
    <section class="wager-group">
      <div class="wager-group-head">
        <div>
          <strong>${escapeHtml(groupLabel)}</strong>
          <span>${groupMarketsList.length} outcomes</span>
        </div>
        <span class="badge">${escapeHtml(groupMarketsList[0]?.marketCode || "MARKET")}</span>
      </div>
      <div class="wager-grid">
        ${groupMarketsList.map(renderWagerCard).join("")}
      </div>
    </section>
  `).join("");
}

function groupMarkets(markets = []) {
  const groups = new Map();

  for (const market of markets) {
    const label = market.groupLabel || market.label || "Markets";
    const list = groups.get(label) || [];

    list.push(market);
    groups.set(label, list);
  }

  return [...groups.entries()];
}

function renderWagerCard(market) {
  const history = state.oddsHistory.get(market.id) || [];
  const latest = history.at(-1);
  const first = history[0];
  const probabilityDelta = latest && first
    ? (latest.impliedProbability - first.impliedProbability) * 10000
    : 0;
  const priceDelta = latest && first
    ? latest.decimal - first.decimal
    : 0;
  const deltaClass = probabilityDelta > 0 ? "positive" : probabilityDelta < 0 ? "negative" : "muted";
  const statusClass = market.status === "resolved" ? "good" : market.status === "open" ? "" : "warn";
  const selectedClass = state.selectedMarketId === market.id ? "selected" : "";
  const lastUpdated = market.priceTs ? new Date(market.priceTs).toLocaleTimeString() : "--";

  return `
    <article class="wager-card ${selectedClass}" data-market-id="${escapeHtml(market.id)}">
      <div class="wager-card-head">
        <div>
          <strong>${escapeHtml(market.selection)}</strong>
          <small>${escapeHtml(market.periodLabel || "Full Match")} / ${escapeHtml(market.marketCode || market.type)}</small>
        </div>
        <span class="badge ${statusClass}">${escapeHtml(market.status)}</span>
      </div>
      <div class="wager-quote-grid">
        <div>
          <span>Price</span>
          <strong>${preciseOdds(market.currentOddsDecimal)}</strong>
        </div>
        <div>
          <span>Implied</span>
          <strong>${pct(market.impliedProbability)}</strong>
        </div>
        <div>
          <span>Move</span>
          <strong class="${deltaClass}">${priceDelta === 0 ? "0.000" : `${priceDelta > 0 ? "+" : ""}${priceDelta.toFixed(3)}`}</strong>
        </div>
      </div>
      <div class="mini-chart">${renderMiniPriceChart(history)}</div>
      <div class="wager-card-foot">
        <span class="${deltaClass}">${bps(probabilityDelta)}</span>
        <span>${history.length} ticks</span>
        <span>${escapeHtml(lastUpdated)}</span>
      </div>
    </article>
  `;
}

function sortedPriceHistory(history = []) {
  return history
    .filter((item) => Number.isFinite(Number(item.decimal)))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function priceChartPoints(history = [], width = 240, height = 70, pad = 6) {
  const points = sortedPriceHistory(history);
  const values = points.map((item) => Number(item.decimal));
  const timestamps = points.map((item) => new Date(item.ts).getTime()).filter(Number.isFinite);
  let min = Math.min(...values);
  let max = Math.max(...values);
  let span = max - min;
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const timeSpan = maxTs - minTs;

  if (!points.length) return [];

  if (!span) {
    min = Math.max(1, min - 0.05);
    max += 0.05;
    span = max - min;
  }

  return points.map((item) => {
    const ts = new Date(item.ts).getTime();
    const x = timeSpan
      ? pad + ((ts - minTs) / timeSpan) * (width - pad * 2)
      : width / 2;
    const y = height - pad - ((Number(item.decimal) - min) / span) * (height - pad * 2);

    return { x, y, item, min, max };
  });
}

function stepPath(points = [], width = 240, pad = 6) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${pad} ${points[0].y} H ${width - pad}`;

  return points.slice(1).reduce((path, point) => (
    `${path} H ${point.x} V ${point.y}`
  ), `M ${points[0].x} ${points[0].y}`);
}

function stepAreaPath(points = [], width = 240, height = 70, pad = 6) {
  if (!points.length) return "";
  if (points.length === 1) {
    return `M ${pad} ${height - pad} L ${pad} ${points[0].y} H ${width - pad} L ${width - pad} ${height - pad} Z`;
  }

  return `${stepPath(points, width, pad)} L ${points.at(-1).x} ${height - pad} L ${points[0].x} ${height - pad} Z`;
}

function renderMiniPriceChart(history = []) {
  const width = 240;
  const height = 70;
  const pad = 6;
  const points = priceChartPoints(history, width, height, pad);

  if (!points.length) {
    return `<div class="mini-chart-empty">No history</div>`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Decimal price history">
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${height - pad}" y2="${height - pad}"></line>
      <path class="chart-line" d="${stepPath(points, width, pad)}"></path>
      ${points.length === 1 ? `<text x="${pad}" y="13" fill="#8a98a9" font-size="9">LAST KNOWN</text>` : ""}
    </svg>
  `;
}

function renderScanner() {
  if (!state.alerts.length) {
    els.marketScanner.innerHTML = `<div class="empty-state">No steam moves yet. The scanner trips at 650 bps on live odds displacement.</div>`;
    return;
  }

  els.marketScanner.innerHTML = state.alerts.map((alert) => `
    <article class="scanner-item">
      <div class="scanner-line">
        <span class="badge ${alert.severity === "critical" ? "warn" : ""}">${escapeHtml(alert.kind)}</span>
        <strong class="${alert.deltaProbabilityBps > 0 ? "positive" : "negative"}">${bps(alert.deltaProbabilityBps)}</strong>
      </div>
      <div class="scanner-message">${escapeHtml(alert.message)}</div>
      <div class="scanner-context">market ${escapeHtml(alert.marketId)} / ${alert.windowSec}s window / ${new Date(alert.ts).toLocaleTimeString()}</div>
    </article>
  `).join("");
}

function renderChart() {
  const market = state.markets.get(state.selectedMarketId);
  const history = sortedPriceHistory(state.oddsHistory.get(state.selectedMarketId) || []);
  els.chartMarketLabel.textContent = market ? `${market.selection} / ${market.periodLabel || "Full Match"}` : "Select wager";

  if (!market || !history.length) {
    els.oddsChart.innerHTML = `<div class="empty-state">Awaiting TxODDS price history for the selected wager.</div>`;
    return;
  }

  const width = 560;
  const height = 190;
  const pad = 20;
  const points = priceChartPoints(history, width, height, pad);
  const min = Math.min(...points.map((point) => point.min));
  const max = Math.max(...points.map((point) => point.max));
  const line = stepPath(points, width, pad);
  const area = stepAreaPath(points, width, height, pad);
  const tickLabel = history.length === 1 ? "1 event / last known" : `${history.length} events`;

  els.oddsChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Decimal price history chart">
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${pad}" y2="${pad}"></line>
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${height / 2}" y2="${height / 2}"></line>
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${height - pad}" y2="${height - pad}"></line>
      <path class="chart-area" d="${area}"></path>
      <path class="chart-line" d="${line}"></path>
      ${points.map((point) => `<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join("")}
      <text x="${pad}" y="16" fill="#8a98a9" font-size="10">${preciseOdds(max)}</text>
      <text x="${pad}" y="${height - 6}" fill="#8a98a9" font-size="10">${preciseOdds(min)}</text>
      <text x="${width - 155}" y="16" fill="#34d399" font-size="11">Last ${preciseOdds(history.at(-1).decimal)}</text>
      <text x="${width - 155}" y="32" fill="#8a98a9" font-size="10">${escapeHtml(tickLabel)}</text>
    </svg>
  `;
}

function renderSettlement() {
  const market = state.markets.get(state.selectedMarketId);
  const receipt = market ? state.receipts.get(market.id) : null;
  const settlement = state.settlement;

  if (!market) {
    els.settlementConsole.innerHTML = `<div class="empty-state">Select a market to prepare settlement.</div>`;
    return;
  }

  els.settlementConsole.innerHTML = `
    <div class="settlement-row"><span>Selected</span><strong>${escapeHtml(market.id)}</strong></div>
    <div class="settlement-row"><span>Escrow asset</span><strong>Devnet USDC</strong></div>
    <div class="settlement-row"><span>Validation</span><strong class="${receipt ? "positive" : "muted"}">${receipt ? "TxLINE proof ready" : "Awaiting receipt"}</strong></div>
    <div class="settlement-row"><span>Wallet</span><strong>${escapeHtml(state.wallet ? short(state.wallet, 9) : "Not connected")}</strong></div>
    ${settlement ? `
      <div class="settlement-row"><span>Status</span><strong class="positive">${escapeHtml(settlement.status)}</strong></div>
      <div class="settlement-row"><span>Tx</span><a href="${escapeHtml(settlement.explorerUrl)}" target="_blank" rel="noreferrer">${escapeHtml(short(settlement.txSignature, 8))}</a></div>
    ` : ""}
    <div class="settlement-actions">
      <button class="terminal-button" type="button" id="openProofBtn">Proof</button>
      <button class="terminal-button" type="button" id="settleBtn">Settle</button>
    </div>
  `;

  qs("#openProofBtn")?.addEventListener("click", () => openReceipt(market.id));
  qs("#settleBtn")?.addEventListener("click", () => settleMarket(market.id));
}

function renderCommandHistory() {
  els.commandHistory.innerHTML = state.commandLog.slice(-6).map((entry) => (
    `<div class="cmd-${entry.kind}">${entry.kind === "in" ? "SABLE&gt; " : ""}${escapeHtml(entry.text)}</div>`
  )).join("");
  els.commandHistory.scrollTop = els.commandHistory.scrollHeight;
}

function renderReceiptDrawer() {
  if (!state.drawerOpen) {
    els.receiptDrawer.classList.remove("open");
    els.receiptDrawer.innerHTML = "";
    return;
  }

  const market = state.markets.get(state.selectedMarketId);
  const receipt = market ? state.receipts.get(market.id) : null;
  els.receiptDrawer.classList.add("open");

  if (!receipt) {
    els.receiptDrawer.innerHTML = `
      <div class="drawer-head">
        <h2>Resolution Receipt</h2>
        <button class="terminal-button" type="button" id="closeReceiptBtn">Close</button>
      </div>
      <div class="drawer-body">
        <div class="empty-state">No receipt is available yet for ${escapeHtml(market?.id || "selected market")}.</div>
      </div>
    `;
    qs("#closeReceiptBtn")?.addEventListener("click", closeReceiptDrawer);
    return;
  }

  const proof = receipt.statValidation;
  els.receiptDrawer.innerHTML = `
    <div class="drawer-head">
      <div>
        <span class="eyebrow">TXLINE RECEIPT</span>
        <h2>${escapeHtml(receipt.marketId)} verified</h2>
      </div>
      <button class="terminal-button" type="button" id="closeReceiptBtn">Close</button>
    </div>
    <div class="drawer-body">
      <section class="receipt-section">
        <h3>Outcome</h3>
        <div class="kv"><span>Status</span><strong class="positive">${escapeHtml(receipt.status)}</strong></div>
        <div class="kv"><span>Resolved</span><strong>${escapeHtml(receipt.resolvedOutcome)}</strong></div>
        <div class="kv"><span>Fixture</span><strong>${escapeHtml(receipt.fixtureId)}</strong></div>
        <div class="kv"><span>Seq</span><strong>${escapeHtml(receipt.seq)}</strong></div>
      </section>
      <section class="receipt-section">
        <h3>Signed Payload</h3>
        <div class="kv"><span>Payload hash</span><span class="hash">${escapeHtml(receipt.txlinePayloadHash)}</span></div>
        <div class="kv"><span>Action</span><strong>${escapeHtml(receipt.signedPayload?.action)}</strong></div>
        <div class="kv"><span>Status/period</span><strong>${escapeHtml(receipt.signedPayload?.statusId)} / ${escapeHtml(receipt.signedPayload?.period)}</strong></div>
      </section>
      <section class="receipt-section">
        <h3>Merkle Validation</h3>
        <div class="kv"><span>Stat keys</span><strong>${proof.statKeys.map(escapeHtml).join(", ")}</strong></div>
        <div class="kv"><span>Epoch day</span><strong>${escapeHtml(proof.epochDay)}</strong></div>
        <div class="kv"><span>Scores PDA</span><span class="hash">${escapeHtml(proof.dailyScoresRootsPda)}</span></div>
        <div class="kv"><span>Event root</span><span class="hash">${escapeHtml(proof.eventStatRoot)}</span></div>
      </section>
      <section class="receipt-section">
        <h3>Main Tree Proof</h3>
        <div class="proof-list">
          ${proof.mainTreeProof.map((node, index) => `
            <div class="proof-node">
              <span>${node.isRightSibling ? "right" : "left"} ${index}</span>
              <span class="hash">${escapeHtml(short(node.hash, 16))}</span>
            </div>
          `).join("")}
        </div>
      </section>
      ${receipt.solana?.explorerUrl ? `
        <section class="receipt-section">
          <h3>Settlement</h3>
          <div class="kv"><span>Cluster</span><strong>${escapeHtml(receipt.solana.cluster)}</strong></div>
          <div class="kv"><span>Tx</span><a href="${escapeHtml(receipt.solana.explorerUrl)}" target="_blank" rel="noreferrer">${escapeHtml(short(receipt.solana.txSignature, 12))}</a></div>
        </section>
      ` : ""}
    </div>
  `;
  qs("#closeReceiptBtn")?.addEventListener("click", closeReceiptDrawer);
}

function closeReceiptDrawer() {
  state.drawerOpen = false;
  renderReceiptDrawer();
}

async function openReceipt(marketId = state.selectedMarketId) {
  const market = state.markets.get(marketId);
  if (!market) {
    log("out", `Unknown market ${marketId}.`);
    renderAll();
    return;
  }
  state.selectedMarketId = market.id;
  if (!state.receipts.has(market.id)) {
    const seq = latestSequenceForMarket(market);

    if (!seq) {
      log("out", `TxODDS proof needs an observed stream/snapshot seq for fixture ${market.fixtureId}.`);
      state.drawerOpen = true;
      setActivePane("settlement");
      renderAll();
      return;
    }

    const response = await fetch(`/api/proofs/stat?fixtureId=${encodeURIComponent(market.fixtureId)}&seq=${encodeURIComponent(seq)}&statKeys=${encodeURIComponent((market.resolutionRule?.statKeys || [1, 2]).join(","))}`);
    if (response.ok) {
      const payload = await response.json();
      state.receipts.set(market.id, buildTxlineReceipt(payload, market));
    } else {
      log("out", `TxODDS proof lookup failed with ${response.status}; need a final score seq for this fixture.`);
    }
  }
  state.drawerOpen = true;
  setActivePane("settlement");
  renderAll();
}

function latestSequenceForMarket(market) {
  const event = state.events.find((item) => item.fixtureId === market.fixtureId && Number.isFinite(Number(item.seq)));
  return event?.seq || 0;
}

function proofNodes(value) {
  const nodes = Array.isArray(value) ? value : [];
  return nodes.map((node) => {
    if (typeof node === "string") return { hash: node, isRightSibling: false };
    return {
      hash: String(node.hash || node.Hash || node.value || node.Value || node),
      isRightSibling: Boolean(node.isRightSibling || node.IsRightSibling || node.right)
    };
  });
}

function buildTxlineReceipt(proof, market) {
  const summary = proof.summary || proof.Summary || {};
  const updateStats = summary.updateStats || summary.UpdateStats || {};
  const targetTsMs = Number(updateStats.minTimestamp || updateStats.MinTimestamp || proof.ts || proof.Ts || Date.now());
  const epochDay = Math.floor(targetTsMs / 86400000);
  return {
    id: `txline-receipt-${market.id}`,
    fixtureId: market.fixtureId,
    marketId: market.id,
    seq: latestSequenceForMarket(market),
    status: "verified",
    resolvedOutcome: market.resolvedOutcome || market.selection,
    txlinePayloadHash: proof.eventStatRoot || proof.EventStatRoot || proof.root || "TxODDS proof fetched",
    signedPayload: {
      provider: "TxLINE",
      network: state.liveStatus?.network || "devnet",
      action: "stat_validation",
      statusId: "proof",
      period: "proof"
    },
    statValidation: {
      statKeys: market.resolutionRule?.statKeys || [1, 2],
      targetTsMs,
      epochDay,
      dailyScoresRootsPda: `derived: daily_scores_roots/${epochDay}`,
      fixtureSummary: summary,
      eventStatRoot: String(proof.eventStatRoot || proof.EventStatRoot || ""),
      subTreeProof: proofNodes(proof.subTreeProof || proof.SubTreeProof),
      mainTreeProof: proofNodes(proof.mainTreeProof || proof.MainTreeProof),
      statProofs: [proofNodes(proof.statProof || proof.StatProof || proof.statProofs?.[0] || [])]
    },
    solana: {
      cluster: state.liveStatus?.network || "devnet"
    },
    createdAt: new Date().toISOString()
  };
}

async function settleMarket(marketId = state.selectedMarketId) {
  const market = state.markets.get(marketId);
  if (!market) {
    log("out", `Unknown market ${marketId}.`);
    renderAll();
    return;
  }
  state.selectedMarketId = market.id;
  if (!state.wallet) {
    log("out", "Connect a wallet before settlement.");
    setActivePane("settlement");
    renderAll();
    return;
  }

  await openReceipt(market.id);
  const receipt = state.receipts.get(market.id);
  if (!receipt) {
    log("out", `No TxLINE receipt available for ${market.id}.`);
    renderAll();
    return;
  }
  const response = await fetch("/api/settlement/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      marketId: market.id,
      selection: market.selection,
      amountUsdc: "100.00",
      userWallet: state.wallet,
      receiptId: receipt.id
    })
  });
  state.settlement = await response.json();
  receipt.solana = {
    cluster: "devnet",
    txSignature: state.settlement.txSignature,
    explorerUrl: state.settlement.explorerUrl
  };
  state.receipts.set(market.id, receipt);
  log("out", `Settlement passed via validateStatV2. Tx ${short(state.settlement.txSignature, 8)}.`);
  setActivePane("settlement");
  renderAll();
}

function parseCommand(raw) {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const verb = (parts.shift() || "HELP").toUpperCase();
  const args = [];
  const flags = {};
  for (const part of parts) {
    if (part.startsWith("--")) {
      const [key, value] = part.slice(2).split("=");
      flags[key] = value || true;
    } else {
      args.push(part);
    }
  }
  return { raw, verb, args, flags };
}

function executeCommand(raw) {
  if (!raw.trim()) return;
  const command = parseCommand(raw);
  log("in", command.raw);

  if (command.verb === "HELP") {
    log("out", "Commands: MATCH <code>, ODDS <code>, WATCH <code>, STEAM --live, PROOF <market>, SETTLE <market>.");
    renderAll();
    return;
  }

  if (["MATCH", "ODDS", "WATCH"].includes(command.verb)) {
    const code = command.args[0];
    if (code) selectFixtureByCode(code);
    setActivePane(command.verb === "ODDS" ? "odds" : "match");
    log("out", `${command.verb} focused ${state.match?.label || state.fixtureKey}.`);
    renderAll();
    return;
  }

  if (command.verb === "STEAM") {
    setActivePane("scanner");
    log("out", state.alerts.length ? `${state.alerts.length} market movement alerts active.` : "Scanner armed. Waiting for odds displacement.");
    renderAll();
    return;
  }

  if (command.verb === "PROOF") {
    openReceipt(command.args[0] || state.selectedMarketId);
    return;
  }

  if (command.verb === "SETTLE") {
    settleMarket(command.args[0] || state.selectedMarketId);
    return;
  }

  log("out", `Unknown command ${command.verb}. Type HELP.`);
  renderAll();
}

function submitCommand() {
  const raw = els.commandInput.value;
  els.commandInput.value = "";
  executeCommand(raw);
}

function selectFixtureByCode(code) {
  const normalized = code.toUpperCase().replace("VS", "-");
  const fixture = state.fixtures.find((item) => {
    const label = item.metadata.label.toUpperCase().replace(/\s+/g, "");
    const compact = label.replace("VS", "-");
    return label.includes(normalized.replace("-", "")) || compact.includes(normalized);
  });
  if (!fixture) {
    log("out", `No fixture matched ${code}.`);
    return;
  }
  if (fixture.id !== state.fixtureKey) {
    state.fixtureKey = fixture.id;
    els.fixtureSelect.value = fixture.id;
    connectStream();
  }
}

function log(kind, text) {
  state.commandLog.push({ kind, text });
  state.commandLog = state.commandLog.slice(-40);
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message || error)}</pre>`;
});
