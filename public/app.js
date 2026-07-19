const state = {
  mode: "live",
  screen: "dashboard",
  routeMarketId: "",
  fixtureKey: "",
  fixtures: [],
  source: null,
  connected: false,
  lastEventAt: null,
  events: [],
  match: null,
  markets: new Map(),
  oddsHistory: new Map(),
  recentLiveMarketIds: new Map(),
  liveTickClearTimer: null,
  alerts: [],
  receipts: new Map(),
  selectedMarketId: null,
  liveStatus: null,
  marketNotice: "",
  historyBackfillFixtureId: "",
  historyLoading: false,
  drawerOpen: false,
  activePane: "match",
  exchangeUserId: "trader-a",
  exchangePortfolio: null,
  exchangeOrderBook: null,
  exchangeTicket: {
    marketId: "",
    orderType: "limit",
    side: "back",
    stake: 25,
    odds: 2
  },
  exchangeNotice: "",
  exchangeBusy: false,
  tradeTicketOpen: false
};

const els = {};

function qs(selector) {
  return document.querySelector(selector);
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function usdc(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} USDC`;
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

function signedDecimal(value = 0) {
  const number = Number(value);
  const sign = number > 0 ? "+" : "";

  if (!Number.isFinite(number) || number === 0) return "0.000";
  return `${sign}${number.toFixed(3)}`;
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

function timeLabel(value = "") {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "--";

  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function titleCase(value = "") {
  return String(value)
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
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

function liveTickVisibleMs() {
  return 8000;
}

function isRecentLiveMarket(marketId = "") {
  const updatedAt = state.recentLiveMarketIds.get(marketId) || 0;
  return updatedAt > 0 && Date.now() - updatedAt < liveTickVisibleMs();
}

function clearLiveTickTimer() {
  const timer = state.liveTickClearTimer;

  if (timer) window.clearTimeout(timer);
  state.liveTickClearTimer = null;
}

function pruneRecentLiveMarkets() {
  const now = Date.now();

  for (const [marketId, updatedAt] of state.recentLiveMarketIds) {
    if (now - updatedAt > liveTickVisibleMs()) {
      state.recentLiveMarketIds.delete(marketId);
    }
  }
}

function resetRecentLiveMarkets() {
  clearLiveTickTimer();
  state.recentLiveMarketIds = new Map();
}

function scheduleLiveTickClear() {
  clearLiveTickTimer();
  state.liveTickClearTimer = window.setTimeout(() => {
    pruneRecentLiveMarkets();
    state.liveTickClearTimer = null;
    renderOdds();
  }, liveTickVisibleMs() + 50);
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

  return `${sportPrefix}${label} · ${start}`;
}

function displaySport(value = "") {
  const sport = String(value || "").trim();

  return sport && sport !== "Unknown" ? sport : "Not supplied";
}

function selectedMarketHash(marketId = state.selectedMarketId) {
  return marketId ? `#/wager/${encodeURIComponent(marketId)}` : "#/dashboard";
}

function currentRoute() {
  const rawHash = window.location.hash.replace(/^#\/?/, "");
  const [screen = "dashboard", ...rest] = rawHash.split("/");
  const encodedMarketId = rest.join("/");
  const marketId = encodedMarketId ? decodeURIComponent(encodedMarketId) : "";

  return {
    screen: screen === "wager" ? "wager" : "dashboard",
    marketId
  };
}

function applyRouteFromHash() {
  const route = currentRoute();

  state.screen = route.screen;
  state.routeMarketId = route.marketId;

  if (route.screen === "wager" && route.marketId) {
    state.selectedMarketId = route.marketId;
  }

  if (route.screen === "wager" && !state.selectedMarketId && state.markets.size) {
    state.selectedMarketId = sortedMarkets()[0]?.id || null;
  }

  renderAll();

  if (state.screen === "wager" && state.selectedMarketId) {
    hydrateMarketOrderBook(state.selectedMarketId);
  }
}

function navigateToDashboard() {
  if (window.location.hash === "#/dashboard" || window.location.hash === "") {
    applyRouteFromHash();
    return;
  }

  window.location.hash = "#/dashboard";
}

function navigateToWager(marketId = state.selectedMarketId) {
  if (!marketId) return;
  state.selectedMarketId = marketId;

  const nextHash = selectedMarketHash(marketId);

  if (window.location.hash === nextHash) {
    applyRouteFromHash();
    return;
  }

  window.location.hash = nextHash;
}

function syncWagerRoute() {
  if (state.screen !== "wager" || !state.selectedMarketId) return;

  const nextHash = selectedMarketHash(state.selectedMarketId);

  state.routeMarketId = state.selectedMarketId;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

function setActivePane(pane) {
  state.activePane = pane;
  document.querySelectorAll(".pane").forEach((el) => {
    el.dataset.focus = el.dataset.pane === pane ? "true" : "false";
  });
}

async function init() {
  els.dashboardScreen = qs("#dashboardScreen");
  els.wagerScreen = qs("#wagerScreen");
  els.dashboardNav = qs("#dashboardNav");
  els.wagerNav = qs("#wagerNav");
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
  els.tradeTicketOverlay = qs("#tradeTicketOverlay");
  els.receiptDrawer = qs("#receiptDrawer");
  els.backToDashboard = qs("#backToDashboard");
  els.wagerTradeShortcut = qs("#wagerTradeShortcut");
  els.wagerPageTitle = qs("#wagerPageTitle");
  els.wagerPageChartTitle = qs("#wagerPageChartTitle");
  els.wagerPageSummary = qs("#wagerPageSummary");
  els.wagerPageChart = qs("#wagerPageChart");
  els.wagerPageHistory = qs("#wagerPageHistory");
  els.wagerHistoryCount = qs("#wagerHistoryCount");
  els.wagerGroupCode = qs("#wagerGroupCode");
  els.wagerPageRelated = qs("#wagerPageRelated");
  els.wagerPageExchange = qs("#wagerPageExchange");

  bindEvents();
  await hydrateLiveFixtures();
  await hydrateExchange();
  connectStream();
  applyRouteFromHash();
  renderAll();
}

function bindEvents() {
  els.dashboardNav.addEventListener("click", navigateToDashboard);
  els.wagerNav.addEventListener("click", () => navigateToWager());
  els.backToDashboard.addEventListener("click", navigateToDashboard);
  els.wagerTradeShortcut.addEventListener("click", openExchangeTicketFromWagerPage);
  els.fixtureSelect.addEventListener("change", async () => {
    await selectFixture(getFixtureRecord());
  });
  els.oddsMonitor.addEventListener("click", (event) => {
    const chartButton = event.target.closest("[data-open-market-id]");
    const tradeButton = event.target.closest("[data-trade-market-id]");

    if (chartButton) {
      navigateToWager(chartButton.dataset.openMarketId);
      return;
    }

    if (tradeButton) {
      state.selectedMarketId = tradeButton.dataset.tradeMarketId;
      openExchangeTicket();
      return;
    }

    const row = event.target.closest("[data-market-id]");
    if (!row) return;
    state.selectedMarketId = row.dataset.marketId;
    setActivePane("odds");
    renderAll();
    hydrateMarketOrderBook();
  });
  els.wagerPageRelated.addEventListener("click", (event) => {
    const relatedButton = event.target.closest("[data-related-market-id]");

    if (!relatedButton) return;

    navigateToWager(relatedButton.dataset.relatedMarketId);
  });
  els.wagerPageExchange.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-wager-action]");

    if (!actionButton) return;

    if (actionButton.dataset.wagerAction === "trade") {
      openExchangeTicketFromWagerPage();
    }

    if (actionButton.dataset.wagerAction === "proof") {
      openReceipt(state.selectedMarketId);
    }
  });
  els.tradeTicketOverlay.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-close-trade-ticket]");

    if (closeButton || event.target === els.tradeTicketOverlay) {
      closeTradeTicket();
    }
  });
  window.addEventListener("hashchange", applyRouteFromHash);
  window.addEventListener("popstate", applyRouteFromHash);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.tradeTicketOpen) {
      closeTradeTicket();
      return;
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
  resetRecentLiveMarkets();
  state.receipts = new Map();
  state.alerts = [];
  state.events = [];
  state.marketNotice = "";
  state.selectedMarketId = record.markets[0]?.id || null;
}

async function selectFixture(record) {
  if (!record) return false;

  state.fixtureKey = record.id;
  els.fixtureSelect.value = record.id;
  applyFixture(record);
  renderAll();

  await hydrateLiveScore(record);
  await hydrateLiveOdds(record);
  syncWagerRoute();
  connectStream();

  return true;
}

function connectStream() {
  if (state.source) state.source.close();
  const record = getFixtureRecord();

  if (record && (!state.match || state.match.fixtureId !== record.metadata.fixtureId)) {
    applyFixture(record);
  }

  state.events = [];
  state.alerts = [];
  resetRecentLiveMarkets();
  state.receipts = new Map();
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
    state.match.scoreStatus = event.scoreStatus === "available" || !state.match.score
      ? event.scoreStatus || state.match.scoreStatus
      : state.match.scoreStatus;
    state.match.score = event.score || state.match.score;
    state.match.clock = event.matchClock || state.match.clock;
  }

  if (state.events.some((item) => item.id === event.id && item.type === event.type)) {
    renderStatus();
    return;
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
  const isBootstrap = event.txlineEventName === "odds_bootstrap";
  const liveUpdatedAt = Date.now();
  const updatedSelections = [];

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

    if (!isBootstrap) {
      const previousDecimal = previous ? Number(previous.decimal) : Number(existingMarket.currentOddsDecimal);
      const currentDecimal = Number(market.currentOddsDecimal);
      const priceDelta = Number.isFinite(previousDecimal) && Number.isFinite(currentDecimal)
        ? currentDecimal - previousDecimal
        : 0;

      state.recentLiveMarketIds.set(market.id, liveUpdatedAt);

      const updatedMarket = state.markets.get(market.id);

      if (updatedMarket) {
        state.markets.set(market.id, {
          ...updatedMarket,
          lastStreamAt: event.ts,
          lastStreamSeq: event.seq
        });
      }

      updatedSelections.push({
        label: market.selection,
        price: preciseOdds(currentDecimal),
        previousPrice: previousDecimal > 0 ? preciseOdds(previousDecimal) : "",
        delta: priceDelta,
        direction: priceDelta > 0 ? "up" : priceDelta < 0 ? "down" : "flat"
      });
    }

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

  if (updatedSelections.length) {
    event.payload.updatedSelections = updatedSelections;
    event.payload.updatedMarketCount = updatedSelections.length;
    event.payload.summary = updatedSelections.slice(0, 3).map(selectionMoveText).join(", ");
    event.payload.summaryExtra = Math.max(0, updatedSelections.length - 3);
    scheduleLiveTickClear();
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
  const fixtureId = record.metadata.fixtureId;
  const markets = await fetchLiveOddsMarkets(record);

  state.markets = new Map();
  state.oddsHistory = new Map();
  seedOddsHistory(markets, "snapshot");

  if (!state.markets.size) {
    state.selectedMarketId = null;
    state.marketNotice = `Loading TxODDS price history for ${record.metadata.label}.`;
  } else {
    state.selectedMarketId = state.markets.has(state.selectedMarketId)
      ? state.selectedMarketId
      : sortedMarkets()[0]?.id || null;
    state.marketNotice = "";
    log("out", `Loaded ${state.markets.size} current TxODDS wager prices for ${record.metadata.label}.`);
  }

  syncWagerRoute();
  renderAll();
  hydrateMarketOrderBook();
  startOddsHistoryBackfill(record, fixtureId);
}

function startOddsHistoryBackfill(record, fixtureId = "") {
  state.historyBackfillFixtureId = fixtureId;
  state.historyLoading = true;
  log("out", `Loading TxODDS price history for ${record.metadata.label}.`);

  hydrateLiveOddsHistory(record, fixtureId)
    .catch((error) => {
      if (state.historyBackfillFixtureId === fixtureId) {
        log("out", `TxODDS price history failed: ${error instanceof Error ? error.message : String(error)}.`);
        renderAll();
      }
    })
    .finally(() => {
      if (state.historyBackfillFixtureId === fixtureId) {
        state.historyLoading = false;
        renderAll();
      }
    });
}

async function hydrateLiveOddsHistory(record, fixtureId = record?.metadata?.fixtureId || "") {
  if (!record?.metadata?.fixtureId || !state.liveStatus?.liveReady) return;

  const response = await fetch(`/api/txline/odds-history/${encodeURIComponent(fixtureId)}?hours=12`);

  if (!response.ok) {
    log("out", `TxODDS odds history failed with ${response.status}. Live ticks will build history from here.`);
    return;
  }

  if (state.historyBackfillFixtureId !== fixtureId || activeFixtureId() !== fixtureId) return;

  const payload = await response.json();
  const rawRows = Array.isArray(payload) ? payload : payload.rows;
  const historyMarkets = normalizeOddsSnapshot(rawRows, record.metadata.fixtureId, record.metadata.teams);

  seedOddsHistory(historyMarkets, "history");

  if (state.historyBackfillFixtureId !== fixtureId || activeFixtureId() !== fixtureId) return;

  if (!state.selectedMarketId && state.markets.size) {
    state.selectedMarketId = sortedMarkets()[0]?.id || null;
  }

  state.marketNotice = state.markets.size
    ? ""
    : `No TxODDS odds snapshot or update history is available for ${record.metadata.label}.`;

  if (historyMarkets.length) {
    log("out", `Backfilled ${historyMarkets.length} TxODDS historical price events.`);
  } else {
    log("out", `No TxODDS historical price events returned for ${record.metadata.label}.`);
  }

  renderAll();
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
  renderWagerPage();
  renderTradeTicketOverlay();
  renderReceiptDrawer();
  renderScreens();
  setActivePane(state.activePane);
}

function renderScreens() {
  const isWagerScreen = state.screen === "wager";
  const selectedMarketExists = Boolean(state.selectedMarketId && state.markets.has(state.selectedMarketId));

  els.dashboardScreen.hidden = isWagerScreen;
  els.wagerScreen.hidden = !isWagerScreen;
  els.dashboardNav.classList.toggle("active", !isWagerScreen);
  els.wagerNav.classList.toggle("active", isWagerScreen);
  els.wagerNav.disabled = !selectedMarketExists;
  document.body.dataset.screen = state.screen;
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
    els.matchTape.innerHTML = `<div class="empty-state">Waiting for TxODDS live scores and odds updates...</div>`;
    return;
  }

  els.matchTape.innerHTML = state.events.map((event) => {
    const item = wireItem(event);

    return `
    <article class="tape-row wire-row ${escapeHtml(item.tone)}">
      <span class="tape-meta">${escapeHtml(item.time)}</span>
      <div>
        <div class="tape-headline">
          <span class="wire-badge ${escapeHtml(item.tone)}">${escapeHtml(item.badge)}</span>
          <strong class="${escapeHtml(item.headlineClass || "")}">${escapeHtml(item.headline)}</strong>
        </div>
        ${renderWireBody(item)}
        <div class="tape-sub">${escapeHtml(item.meta)}</div>
      </div>
    </article>
  `;
  }).join("");
}

function rawEventAction(event = {}) {
  const payload = event.payload || {};
  return String(
    payload.action ||
    payload.Action ||
    payload.status ||
    payload.Status ||
    payload.reason ||
    payload.note ||
    ""
  ).trim();
}

function scoreLineLabel(event = {}) {
  const score = event.score || {};
  const teams = event.teams || state.match?.teams || {};
  const homeScore = scoreValue(score, "home");
  const awayScore = scoreValue(score, "away");

  if (homeScore === "--" || awayScore === "--") return "";

  return `${teams.home || "Home"} ${homeScore}-${awayScore} ${teams.away || "Away"}`;
}

function wireTimeLabel(event = {}) {
  const clock = clockLabel(event.matchClock);

  if (clock && clock !== "--" && clock !== "NS") return clock;

  return timeLabel(event.ts) === "--" ? "Live" : timeLabel(event.ts);
}

function summarizeSelections(selections = [], limit = 3) {
  const visible = selections.slice(0, limit);
  const hiddenCount = Math.max(0, selections.length - visible.length);
  const suffix = hiddenCount ? `, plus ${hiddenCount} more` : "";

  return `${visible.map(selectionMoveText).join(", ")}${suffix}`;
}

function selectionMoveText(move = {}) {
  if (typeof move === "string") return move;

  const label = move.label || "Selection";
  const price = move.price || "--";
  const delta = Number(move.delta);
  const moveText = Number.isFinite(delta) && delta !== 0
    ? ` (${signedDecimal(delta)})`
    : "";

  return `${label} ${price}${moveText}`;
}

function selectionMoveClass(move = {}) {
  if (move.direction === "up") return "move-up";
  if (move.direction === "down") return "move-down";

  return "move-flat";
}

function renderSelectionMovesHtml(selections = [], limit = 3) {
  const visible = selections.slice(0, limit);
  const hiddenCount = Math.max(0, selections.length - visible.length);
  const spans = visible.map((move) => (
    `<span class="wire-price-move ${escapeHtml(selectionMoveClass(move))}">${escapeHtml(selectionMoveText(move))}</span>`
  ));
  const suffix = hiddenCount ? ` <span class="muted">plus ${hiddenCount} more</span>` : "";

  return `${spans.join('<span class="muted">, </span>')}${suffix}`;
}

function renderWireBody(item = {}) {
  if (item.bodyHtml) return `<div class="tape-body">${item.bodyHtml}</div>`;
  if (item.body) return `<div class="tape-body">${escapeHtml(item.body)}</div>`;

  return "";
}

function wireMeta(event = {}, source = "TxODDS live feed") {
  const parts = [source, timeLabel(event.ts)].filter((item) => item && item !== "--");

  return parts.join(" · ");
}

function matchStatusWireItem(event = {}) {
  const action = rawEventAction(event);
  const normalizedAction = action.toLowerCase();

  if (normalizedAction.includes("disconnect")) {
    return {
      badge: "Feed",
      tone: "warn",
      headline: "Score feed disconnected",
      body: "Sable is waiting for the next TxODDS score update. Odds may still update separately.",
      meta: wireMeta(event, "TxODDS score feed"),
      time: wireTimeLabel(event)
    };
  }

  if (normalizedAction.includes("connect")) {
    return {
      badge: "Feed",
      tone: "good",
      headline: "Score feed connected",
      body: "Live score updates are available for this fixture.",
      meta: wireMeta(event, "TxODDS score feed"),
      time: wireTimeLabel(event)
    };
  }

  if (normalizedAction.includes("final")) {
    const scoreLine = scoreLineLabel(event);

    return {
      badge: "Final",
      tone: "good",
      headline: "Match finished",
      body: scoreLine || "TxODDS marked this match as final.",
      meta: wireMeta(event, "TxODDS score feed"),
      time: wireTimeLabel(event)
    };
  }

  return {
    badge: "Match",
    tone: "neutral",
    headline: action ? titleCase(action) : "Match status updated",
    body: scoreLineLabel(event) || "TxODDS published a match status update.",
    meta: wireMeta(event, "TxODDS score feed"),
    time: wireTimeLabel(event)
  };
}

function oddsWireItem(event = {}) {
  const isBootstrap = event.txlineEventName === "odds_bootstrap";
  const selections = Array.isArray(event.payload?.updatedSelections)
    ? event.payload.updatedSelections
    : [];
  const marketCount = Number(event.payload?.updatedMarketCount || event.payload?.markets?.length || 0);
  const headline = selections.length === 1
    ? `Odds updated: ${selectionMoveText(selections[0])}`
    : selections.length > 1
      ? `${selections.length} live prices updated`
      : `${marketCount} current prices loaded`;

  if (isBootstrap) {
    return {
      badge: "Odds",
      tone: "neutral",
      headline: "Current odds loaded",
      body: marketCount
        ? `Loaded ${marketCount} TxODDS prices for this fixture.`
        : "TxODDS returned the current odds snapshot.",
      meta: wireMeta(event, "TxODDS odds feed"),
      time: wireTimeLabel(event)
    };
  }

  return {
    badge: "Odds",
    tone: "live",
    headline,
    headlineClass: selections.length === 1 ? selectionMoveClass(selections[0]) : "",
    body: selections.length ? "" : "A live TxODDS odds tick updated this fixture.",
    bodyHtml: selections.length
      ? `Latest prices: ${renderSelectionMovesHtml(selections)}.`
      : "",
    meta: wireMeta(event, "TxODDS odds feed"),
    time: wireTimeLabel(event)
  };
}

function wireItem(event = {}) {
  if (event.type === "goal") {
    const teams = event.teams || state.match?.teams || {};
    const team = event.actor?.team === "home" ? teams.home : teams.away;
    const player = event.actor?.playerName && event.actor.playerName !== "Unknown"
      ? `Scorer: ${event.actor.playerName}. `
      : "";

    return {
      badge: "Goal",
      tone: "good",
      headline: `${team || "Team"} scored`,
      body: `${player}${scoreLineLabel(event) || "Score updated."}`,
      meta: wireMeta(event, "TxODDS score feed"),
      time: wireTimeLabel(event)
    };
  }

  if (event.type === "card") {
    const card = titleCase(event.payload?.card || "Card");
    const player = event.actor?.playerName && event.actor.playerName !== "Unknown"
      ? `Shown to ${event.actor.playerName}.`
      : "Disciplinary event reported by TxODDS.";

    return {
      badge: "Card",
      tone: "warn",
      headline: `${card} shown`,
      body: player,
      meta: wireMeta(event, "TxODDS score feed"),
      time: wireTimeLabel(event)
    };
  }

  if (event.type === "var") {
    return {
      badge: "VAR",
      tone: "warn",
      headline: "VAR review updated",
      body: [event.payload?.type, event.payload?.outcome].filter(Boolean).join(": ") || "VAR event reported by TxODDS.",
      meta: wireMeta(event, "TxODDS score feed"),
      time: wireTimeLabel(event)
    };
  }

  if (event.type === "odds_tick") return oddsWireItem(event);
  if (event.type === "match_status") return matchStatusWireItem(event);

  if (event.type === "market_resolved") {
    const market = state.markets.get(event.payload?.marketId);

    return {
      badge: "Result",
      tone: "good",
      headline: `${market?.selection || "Selected wager"} resolved`,
      body: event.payload?.resolvedOutcome
        ? `Outcome: ${event.payload.resolvedOutcome}. TxODDS proof is available.`
        : "TxODDS resolution data is available.",
      meta: wireMeta(event, "TxODDS validation"),
      time: wireTimeLabel(event)
    };
  }

  return {
    badge: "Update",
    tone: "neutral",
    headline: eventHeadline(event),
    body: "TxODDS published a live update for this fixture.",
    meta: wireMeta(event),
    time: wireTimeLabel(event)
  };
}

function eventHeadline(event) {
  if (event.type === "goal") {
    const teams = event.teams || state.match?.teams || {};
    const team = event.actor?.team === "home" ? teams.home : teams.away;
    const scoreLine = scoreLineLabel(event);

    return `${team || "Team"} goal${scoreLine ? ` (${scoreLine})` : ""}`;
  }
  if (event.type === "card") {
    return `${event.payload.card || "Card"} card: ${event.actor?.playerName || "Unknown"}`;
  }
  if (event.type === "var") {
    return `VAR ${event.payload.type || ""}: ${event.payload.outcome || ""}`;
  }
  if (event.type === "odds_tick") {
    if (event.payload.summary) {
      const suffix = event.payload.summaryExtra ? ` +${event.payload.summaryExtra} more` : "";
      return `${event.payload.reason || "Odds tick"}: ${event.payload.summary}${suffix}`;
    }

    return `${event.payload.reason || "Odds tick"}: ${(event.payload.markets || []).length} prices`;
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
  const coverage = [
    state.connected ? "Live stream" : "Stream idle",
    markets.length ? "Odds available" : "Odds pending",
    match.scoreStatus === "available" ? "Scores available" : "Scores pending"
  ].join(" / ");

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
      <div class="metric"><span>Sport</span><strong>${escapeHtml(displaySport(match.sport))}</strong></div>
      <div class="metric"><span>Competition</span><strong>${escapeHtml(match.competition)}</strong></div>
      <div class="metric"><span>Coverage</span><strong>${escapeHtml(coverage)}</strong></div>
      <div class="metric"><span>Last Update</span><strong>${escapeHtml(latestEvent ? wireTimeLabel(latestEvent) : "--")}</strong></div>
    </div>
  `;
}

function renderOdds() {
  const markets = sortedMarkets();
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

function sortedMarkets() {
  return [...state.markets.values()].sort((a, b) => (
    String(a.sortKey || a.id).localeCompare(String(b.sortKey || b.id))
  ));
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
  const isLive = isRecentLiveMarket(market.id);
  const selectedClass = state.selectedMarketId === market.id ? "selected" : "";
  const liveClass = isLive ? "live" : "";
  const cardClass = ["wager-card", selectedClass, liveClass].filter(Boolean).join(" ");
  const badgeClass = isLive ? "live" : statusClass;
  const badgeText = isLive ? "live" : market.status;
  const statusBadge = market.status === "open"
    ? `<button class="badge trade-badge ${badgeClass}" type="button" data-trade-market-id="${escapeHtml(market.id)}">${escapeHtml(badgeText)}</button>`
    : `<span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>`;
  const moveLabel = isLive ? "LIVE TICK" : bps(probabilityDelta);
  const moveClass = isLive ? "positive" : deltaClass;
  const lastUpdated = market.priceTs ? new Date(market.priceTs).toLocaleTimeString() : "--";

  return `
    <article class="${cardClass}" data-market-id="${escapeHtml(market.id)}">
      <div class="wager-card-head">
        <div>
          <strong>${escapeHtml(market.selection)}</strong>
          <small>${escapeHtml(market.periodLabel || "Full Match")} / ${escapeHtml(market.marketCode || market.type)}</small>
        </div>
        ${statusBadge}
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
        <span class="${moveClass}">${escapeHtml(moveLabel)}</span>
        <span>${history.length} ticks</span>
        <span>${escapeHtml(lastUpdated)}</span>
        <button class="terminal-button chart-open-button" type="button" data-open-market-id="${escapeHtml(market.id)}">Chart</button>
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
    els.marketScanner.innerHTML = `<div class="empty-state">No major market moves yet. Sable will flag a wager when live TxODDS prices move sharply.</div>`;
    return;
  }

  els.marketScanner.innerHTML = state.alerts.map((alert) => {
    const item = scannerItem(alert);

    return `
    <article class="scanner-item">
      <div class="scanner-line">
        <span class="badge ${alert.severity === "critical" ? "warn" : ""}">${escapeHtml(item.badge)}</span>
        <strong class="${alert.deltaProbabilityBps > 0 ? "positive" : "negative"}">${escapeHtml(item.move)}</strong>
      </div>
      <div class="scanner-message">${escapeHtml(item.message)}</div>
      <div class="scanner-context">${escapeHtml(item.context)}</div>
    </article>
  `;
  }).join("");
}

function pointMoveLabel(deltaBps = 0) {
  const points = Number(deltaBps) / 100;
  const sign = points > 0 ? "+" : "";

  return `${sign}${points.toFixed(1)} pts`;
}

function scannerItem(alert = {}) {
  const market = state.markets.get(alert.marketId);
  const direction = alert.deltaProbabilityBps > 0 ? "increased" : "fell";
  const selection = market?.selection || "Selected wager";
  const group = market?.groupLabel || market?.label || "Market";

  return {
    badge: alert.kind === "steam_move" ? "Steam Move" : titleCase(alert.kind || "Alert"),
    move: pointMoveLabel(alert.deltaProbabilityBps),
    message: `${selection} implied probability ${direction} sharply.`,
    context: `${group} · detected ${timeLabel(alert.ts)}`
  };
}

function renderChart() {
  const market = state.markets.get(state.selectedMarketId);
  const history = sortedPriceHistory(state.oddsHistory.get(state.selectedMarketId) || []);
  els.chartMarketLabel.textContent = market ? `${market.selection} / ${market.periodLabel || "Full Match"}` : "Select wager";

  if (!market || !history.length) {
    els.oddsChart.innerHTML = `<div class="empty-state">Awaiting TxODDS price history for the selected wager.</div>`;
    return;
  }

  els.oddsChart.innerHTML = renderPriceChartSvg(history, {
    width: 560,
    height: 190,
    pad: 20,
    labelSize: 10
  });
}

function renderPriceChartSvg(history = [], options = {}) {
  const width = Number(options.width || 720);
  const height = Number(options.height || 260);
  const pad = Number(options.pad || 24);
  const labelSize = Number(options.labelSize || 11);
  const points = priceChartPoints(history, width, height, pad);
  const sorted = sortedPriceHistory(history);
  const first = sorted[0];
  const latest = sorted.at(-1);
  const min = points.length ? Math.min(...points.map((point) => point.min)) : 0;
  const max = points.length ? Math.max(...points.map((point) => point.max)) : 0;
  const line = stepPath(points, width, pad);
  const area = stepAreaPath(points, width, height, pad);
  const tickLabel = sorted.length === 1 ? "1 event / last known" : `${sorted.length} events`;
  const firstTime = first ? timeLabel(first.ts) : "--";
  const latestTime = latest ? timeLabel(latest.ts) : "--";

  if (!points.length) return `<div class="empty-state">Awaiting TxODDS price history for this wager.</div>`;

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Decimal price history chart">
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${pad}" y2="${pad}"></line>
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${height / 2}" y2="${height / 2}"></line>
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${height - pad}" y2="${height - pad}"></line>
      <path class="chart-area" d="${area}"></path>
      <path class="chart-line" d="${line}"></path>
      ${points.map((point) => `<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="3.5"></circle>`).join("")}
      <text x="${pad}" y="${pad - 6}" fill="#8a98a9" font-size="${labelSize}">${preciseOdds(max)}</text>
      <text x="${pad}" y="${height - 7}" fill="#8a98a9" font-size="${labelSize}">${preciseOdds(min)}</text>
      <text x="${width - 190}" y="${pad - 6}" fill="#34d399" font-size="${labelSize + 1}">Last ${preciseOdds(latest?.decimal)}</text>
      <text x="${width - 190}" y="${pad + 11}" fill="#8a98a9" font-size="${labelSize}">${escapeHtml(tickLabel)}</text>
      <text x="${pad}" y="${height - pad + 17}" fill="#8a98a9" font-size="${labelSize}">${escapeHtml(firstTime)}</text>
      <text x="${width - pad - 48}" y="${height - pad + 17}" fill="#8a98a9" font-size="${labelSize}">${escapeHtml(latestTime)}</text>
    </svg>
  `;
}

function priceHistoryStats(history = []) {
  const sorted = sortedPriceHistory(history);
  const first = sorted[0];
  const latest = sorted.at(-1);
  const previous = sorted.length > 1 ? sorted.at(-2) : first;
  const values = sorted.map((point) => Number(point.decimal));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const delta = first && latest ? Number(latest.decimal) - Number(first.decimal) : 0;
  const lastDelta = previous && latest ? Number(latest.decimal) - Number(previous.decimal) : 0;
  const probabilityDeltaBps = first && latest
    ? (Number(latest.impliedProbability) - Number(first.impliedProbability)) * 10000
    : 0;

  return {
    first,
    latest,
    previous,
    min,
    max,
    delta,
    lastDelta,
    probabilityDeltaBps,
    count: sorted.length
  };
}

function valueClass(value = 0) {
  const number = Number(value);

  if (number > 0) return "positive";
  if (number < 0) return "negative";
  return "muted";
}

function marketContextLabel(market = {}) {
  return [
    state.match?.label,
    market.groupLabel,
    market.periodLabel || "Full Match"
  ].filter(Boolean).join(" / ");
}

function relatedMarkets(market = {}) {
  return sortedMarkets().filter((item) => (
    item.id !== market.id &&
    item.groupLabel === market.groupLabel
  ));
}

function renderWagerPage() {
  const market = state.markets.get(state.selectedMarketId);
  const history = sortedPriceHistory(state.oddsHistory.get(state.selectedMarketId) || []);
  const missingMarketId = state.routeMarketId || state.selectedMarketId || "";

  if (!market) {
    els.wagerPageTitle.textContent = "Wager";
    els.wagerPageChartTitle.textContent = "Decimal Odds";
    els.wagerHistoryCount.textContent = "0";
    els.wagerGroupCode.textContent = "MARKET";
    els.wagerPageSummary.innerHTML = `<div class="empty-state">${missingMarketId ? "Wager not loaded for the selected fixture." : "No wager selected."}</div>`;
    els.wagerPageChart.innerHTML = `<div class="empty-state">No chart is available.</div>`;
    els.wagerPageHistory.innerHTML = `<div class="empty-state">No price ticks are available.</div>`;
    els.wagerPageRelated.innerHTML = `<div class="empty-state">No related outcomes are available.</div>`;
    els.wagerPageExchange.innerHTML = `<div class="empty-state">No exchange book is available.</div>`;
    return;
  }

  els.wagerPageTitle.textContent = market.selection;
  els.wagerPageChartTitle.textContent = `${market.groupLabel || "Market"} / ${market.periodLabel || "Full Match"}`;
  els.wagerHistoryCount.textContent = String(history.length);
  els.wagerGroupCode.textContent = market.marketCode || "MARKET";
  els.wagerPageSummary.innerHTML = renderWagerSummary(market, history);
  els.wagerPageChart.innerHTML = history.length
    ? renderPriceChartSvg(history, { width: 980, height: 380, pad: 38, labelSize: 13 })
    : `<div class="empty-state">Awaiting TxODDS price history for this wager.</div>`;
  els.wagerPageHistory.innerHTML = renderWagerHistoryTable(history);
  els.wagerPageRelated.innerHTML = renderRelatedMarkets(market);
  els.wagerPageExchange.innerHTML = renderWagerExchangeSnapshot(market);
}

function renderWagerSummary(market = {}, history = []) {
  const stats = priceHistoryStats(history);
  const price = Number(market.currentOddsDecimal || stats.latest?.decimal || 0);
  const probability = Number(market.impliedProbability || stats.latest?.impliedProbability || 0);
  const latestTs = stats.latest?.ts || market.priceTs || "";
  const rawSport = String(state.match?.sport || "").trim();
  const eyebrow = rawSport && rawSport !== "Unknown"
    ? rawSport
    : state.match?.competition || "TxODDS";
  const liveClass = isRecentLiveMarket(market.id) ? "positive" : "muted";
  const liveLabel = isRecentLiveMarket(market.id) ? "Live tick" : market.status || "open";

  return `
    <div class="wager-title-strip">
      <div>
        <span class="eyebrow">${escapeHtml(eyebrow)}</span>
        <strong>${escapeHtml(marketContextLabel(market))}</strong>
      </div>
      <span class="badge ${escapeHtml(liveClass)}">${escapeHtml(liveLabel)}</span>
    </div>
    <div class="metric-grid wager-stat-grid">
      <div class="metric"><span>Price</span><strong>${preciseOdds(price)}</strong></div>
      <div class="metric"><span>Implied</span><strong>${pct(probability)}</strong></div>
      <div class="metric"><span>Session Move</span><strong class="${valueClass(stats.delta)}">${signedDecimal(stats.delta)}</strong></div>
      <div class="metric"><span>Last Tick</span><strong class="${valueClass(stats.lastDelta)}">${signedDecimal(stats.lastDelta)}</strong></div>
      <div class="metric"><span>High</span><strong>${preciseOdds(stats.max)}</strong></div>
      <div class="metric"><span>Low</span><strong>${preciseOdds(stats.min)}</strong></div>
      <div class="metric"><span>Ticks</span><strong>${stats.count}</strong></div>
      <div class="metric"><span>Updated</span><strong>${escapeHtml(timeLabel(latestTs))}</strong></div>
    </div>
  `;
}

function renderWagerHistoryTable(history = []) {
  const sorted = sortedPriceHistory(history);
  const rows = sorted.map((point, index) => ({
    point,
    previous: index > 0 ? sorted[index - 1] : null
  })).slice(-30).reverse();

  if (!rows.length) return `<div class="empty-state">No price ticks are available.</div>`;

  return `
    <div class="history-table">
      <div class="history-row history-head">
        <span>Time</span>
        <span>Price</span>
        <span>Implied</span>
        <span>Move</span>
      </div>
      ${rows.map(({ point, previous }) => {
        const delta = previous ? Number(point.decimal) - Number(previous.decimal) : 0;

        return `
          <div class="history-row">
            <span>${escapeHtml(timeLabel(point.ts))}</span>
            <strong>${preciseOdds(point.decimal)}</strong>
            <span>${pct(point.impliedProbability)}</span>
            <strong class="${valueClass(delta)}">${signedDecimal(delta)}</strong>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderRelatedMarkets(market = {}) {
  const siblings = relatedMarkets(market);

  if (!siblings.length) return `<div class="empty-state">No related outcomes are available.</div>`;

  return siblings.map((item) => {
    const history = state.oddsHistory.get(item.id) || [];
    const stats = priceHistoryStats(history);

    return `
      <button class="related-market" type="button" data-related-market-id="${escapeHtml(item.id)}">
        <span>
          <strong>${escapeHtml(item.selection)}</strong>
          <small>${escapeHtml(item.periodLabel || "Full Match")} / ${escapeHtml(item.marketCode || item.type)}</small>
        </span>
        <span>
          <strong>${preciseOdds(item.currentOddsDecimal)}</strong>
          <small class="${valueClass(stats.delta)}">${signedDecimal(stats.delta)}</small>
        </span>
      </button>
    `;
  }).join("");
}

function renderWagerExchangeSnapshot(market = {}) {
  const book = state.exchangeOrderBook?.marketId === market.id
    ? state.exchangeOrderBook
    : { back: [], lay: [], trades: [] };
  const receiptStatus = state.receipts.has(market.id) ? "Proof Ready" : "Proof";

  return `
    <div class="wager-exchange-actions">
      <button class="terminal-button primary" type="button" data-wager-action="trade">Open Trade Ticket</button>
      <button class="terminal-button" type="button" data-wager-action="proof">${escapeHtml(receiptStatus)}</button>
    </div>
    <div class="exchange-book">
      <section>
        <h3>Back Book</h3>
        ${renderBookLevels(book.back, "back")}
      </section>
      <section>
        <h3>Lay Book</h3>
        ${renderBookLevels(book.lay, "lay")}
      </section>
    </div>
    <section class="exchange-section">
      <h3>Matched Trades</h3>
      ${renderTradeRows(book.trades || [])}
    </section>
  `;
}

async function hydrateExchange() {
  await hydrateExchangePortfolio();
  await hydrateMarketOrderBook();
}

async function hydrateExchangePortfolio() {
  const response = await fetch(`/api/exchange/user/${encodeURIComponent(state.exchangeUserId)}`);

  if (response.ok) {
    state.exchangePortfolio = await response.json();
  }
}

async function hydrateMarketOrderBook(marketId = state.selectedMarketId) {
  if (!marketId) return;

  const response = await fetch(`/api/exchange/book/${encodeURIComponent(marketId)}`);

  if (response.ok) {
    state.exchangeOrderBook = await response.json();
    renderSettlement();
    renderWagerPage();
  }
}

function selectedMarket() {
  return state.markets.get(state.selectedMarketId);
}

function setExchangeTicketDefaults(market = selectedMarket()) {
  if (!market) return;
  if (state.exchangeTicket.marketId === market.id && Number(state.exchangeTicket.odds) > 0) return;

  state.exchangeTicket = {
    ...state.exchangeTicket,
    marketId: market.id,
    orderType: state.exchangeTicket.orderType || "limit",
    odds: Number(market.currentOddsDecimal || state.exchangeTicket.odds || 2),
    stake: Number(state.exchangeTicket.stake || 25)
  };
}

function openExchangeTicket() {
  const market = selectedMarket();

  if (!market) return;

  setExchangeTicketDefaults(market);
  state.tradeTicketOpen = true;
  state.exchangeNotice = "";
  renderAll();
  hydrateExchange();
}

function openExchangeTicketFromWagerPage() {
  const market = selectedMarket();

  if (!market) return;

  openExchangeTicket();
}

function closeTradeTicket() {
  state.tradeTicketOpen = false;
  renderTradeTicketOverlay();
}

async function switchExchangeUser(userId = "trader-a") {
  state.exchangeUserId = userId;
  state.exchangeNotice = `Switched to ${userId === "trader-a" ? "Trader A" : "Trader B"}.`;
  await hydrateExchangePortfolio();
  renderAll();
}

function tradeExposure(side = "back", oddsValue = 0, stakeValue = 0) {
  const price = Number(oddsValue);
  const stake = Number(stakeValue);

  if (!Number.isFinite(price) || !Number.isFinite(stake)) return 0;
  return side === "lay" ? stake * Math.max(price - 1, 0) : stake;
}

async function placeExchangeOrder() {
  const market = selectedMarket();
  const oddsInput = qs("#exchangeOdds");
  const stakeInput = qs("#exchangeStake");
  const oddsValue = Number(oddsInput?.value || state.exchangeTicket.odds);
  const stakeValue = Number(stakeInput?.value || state.exchangeTicket.stake);
  const orderType = state.exchangeTicket.orderType || "limit";
  let payload = null;

  if (!market || state.exchangeBusy) return;

  state.exchangeBusy = true;
  state.exchangeTicket = {
    ...state.exchangeTicket,
    marketId: market.id,
    orderType,
    odds: oddsValue,
    stake: stakeValue
  };
  renderTradeTicketOverlay();

  try {
    const response = await fetch("/api/exchange/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.exchangeUserId,
        marketId: market.id,
        outcome: market.selection,
        side: state.exchangeTicket.side,
        orderType,
        odds: oddsValue,
        stake: stakeValue
      })
    });

    payload = await response.json();

    if (!response.ok) {
      state.exchangeNotice = payload.message || payload.error || "Order rejected.";
      return;
    }

    state.exchangePortfolio = payload.portfolio;
    state.exchangeOrderBook = payload.orderBook;
    state.exchangeNotice = payload.trades?.length
      ? `Matched ${payload.trades.length} trade${payload.trades.length === 1 ? "" : "s"} on ${market.selection}.`
      : orderType === "market"
        ? `No liquidity crossed for ${market.selection}.`
        : `${state.exchangeTicket.side === "back" ? "Back" : "Lay"} limit order posted for ${market.selection}.`;
  } finally {
    state.exchangeBusy = false;
    renderAll();
  }
}

async function cancelExchangeOrder(orderId = "") {
  const market = selectedMarket();
  let payload = null;

  if (!orderId || !market || state.exchangeBusy) return;

  state.exchangeBusy = true;
  renderTradeTicketOverlay();

  try {
    const response = await fetch("/api/exchange/orders/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.exchangeUserId,
        orderId
      })
    });

    payload = await response.json();

    if (!response.ok) {
      state.exchangeNotice = payload.message || payload.error || "Cancel failed.";
      return;
    }

    state.exchangePortfolio = payload.portfolio;
    state.exchangeOrderBook = payload.orderBook;
    state.exchangeNotice = `Cancelled unmatched order size. Refunded ${usdc(payload.refund)}.`;
  } finally {
    state.exchangeBusy = false;
    renderAll();
  }
}

async function cashOutExchangePosition() {
  const market = selectedMarket();
  let payload = null;

  if (!market || state.exchangeBusy) return;

  state.exchangeBusy = true;
  renderTradeTicketOverlay();

  try {
    const response = await fetch("/api/exchange/cashout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.exchangeUserId,
        marketId: market.id,
        outcome: market.selection
      })
    });

    payload = await response.json();

    if (!response.ok) {
      state.exchangeNotice = payload.message || payload.error || "Cash out failed.";
      return;
    }

    state.exchangePortfolio = payload.portfolio;
    state.exchangeOrderBook = payload.orderBook;
    state.exchangeNotice = payload.trades?.length
      ? `Cash out crossed ${payload.trades.length} trade${payload.trades.length === 1 ? "" : "s"} via ${payload.cashOut.closeSide}.`
      : "No cash-out liquidity crossed.";
  } finally {
    state.exchangeBusy = false;
    renderAll();
  }
}

async function settleExchangeMarket() {
  const market = state.markets.get(state.selectedMarketId);
  let payload = null;

  if (!market || state.exchangeBusy) return;

  state.exchangeBusy = true;
  renderTradeTicketOverlay();

  try {
    const response = await fetch("/api/exchange/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        marketId: market.id,
        winningOutcome: market.selection,
        txlinePayload: {
          fixtureId: market.fixtureId,
          market: market.groupLabel,
          outcome: market.selection,
          source: "TxODDS selected outcome",
          settledAt: new Date().toISOString()
        }
      })
    });

    payload = await response.json();

    if (!response.ok) {
      state.exchangeNotice = payload.message || payload.error || "Settlement failed.";
      return;
    }

    state.exchangeOrderBook = payload.orderBook;
    await hydrateExchangePortfolio();
    state.exchangeNotice = `Settled ${market.selection}. Payouts: ${payload.settlement.payouts.length}. Rake: ${usdc(payload.settlement.rake)}.`;
  } finally {
    state.exchangeBusy = false;
    renderAll();
  }
}

function renderBookLevels(levels = [], side = "back") {
  if (!levels.length) {
    return `<div class="book-empty">No ${side} orders</div>`;
  }

  return levels.slice(0, 5).map((level) => `
    <div class="book-level">
      <span>${escapeHtml(level.outcome)}</span>
      <strong>${preciseOdds(level.odds)}</strong>
      <span>${usdc(level.totalStake)}</span>
    </div>
  `).join("");
}

function renderOpenOrders(orders = []) {
  if (!orders.length) return `<div class="book-empty">No open orders for this trader.</div>`;

  return orders.slice(0, 4).map((order) => `
    <div class="exchange-order">
      <span class="${order.side === "back" ? "positive" : "negative"}">${escapeHtml(order.side)}</span>
      <strong>${escapeHtml(order.outcome)} @ ${order.orderType === "market" ? "MARKET" : preciseOdds(order.odds)}</strong>
      <span>${usdc(order.unmatched)} open</span>
      <button class="terminal-button order-cancel-button" type="button" data-cancel-order-id="${escapeHtml(order.id)}">Cancel</button>
    </div>
  `).join("");
}

function renderTradeRows(trades = []) {
  if (!trades.length) return `<div class="book-empty">No matched trades yet.</div>`;

  return trades.slice(-4).reverse().map((trade) => `
    <div class="exchange-order">
      <span>${escapeHtml(trade.status)}</span>
      <strong>${escapeHtml(trade.outcome)} @ ${preciseOdds(trade.odds)}</strong>
      <span>${usdc(trade.stake)}</span>
    </div>
  `).join("");
}

function bindCancelOrderButtons() {
  document.querySelectorAll("[data-cancel-order-id]").forEach((button) => {
    button.addEventListener("click", () => cancelExchangeOrder(button.dataset.cancelOrderId));
  });
}

function bindExchangeControls() {
  qs("#traderA")?.addEventListener("click", () => switchExchangeUser("trader-a"));
  qs("#traderB")?.addEventListener("click", () => switchExchangeUser("trader-b"));
  qs("#exchangeBack")?.addEventListener("click", () => {
    state.exchangeTicket.side = "back";
    renderTradeTicketOverlay();
  });
  qs("#exchangeLay")?.addEventListener("click", () => {
    state.exchangeTicket.side = "lay";
    renderTradeTicketOverlay();
  });
  qs("#exchangeLimit")?.addEventListener("click", () => {
    state.exchangeTicket.orderType = "limit";
    renderTradeTicketOverlay();
  });
  qs("#exchangeMarket")?.addEventListener("click", () => {
    state.exchangeTicket.orderType = "market";
    renderTradeTicketOverlay();
  });
  qs("#exchangeStake")?.addEventListener("input", (event) => {
    state.exchangeTicket.stake = Number(event.target.value || 0);
  });
  qs("#exchangeOdds")?.addEventListener("input", (event) => {
    state.exchangeTicket.odds = Number(event.target.value || 0);
  });
  qs("#placeExchangeOrder")?.addEventListener("click", placeExchangeOrder);
  qs("#cashOutExchangePosition")?.addEventListener("click", cashOutExchangePosition);
  qs("#settleExchangeMarket")?.addEventListener("click", settleExchangeMarket);
  bindCancelOrderButtons();
}

function renderSettlement() {
  const market = selectedMarket();

  if (!market) {
    els.settlementConsole.innerHTML = `<div class="empty-state">Select an open outcome to trade against another simulated user.</div>`;
    return;
  }

  setExchangeTicketDefaults(market);

  const portfolio = state.exchangePortfolio;
  const user = portfolio?.user;
  const book = state.exchangeOrderBook?.marketId === market.id ? state.exchangeOrderBook : { back: [], lay: [], trades: [] };
  const accountLabel = state.exchangeUserId === "trader-a" ? "Trader A" : "Trader B";

  els.settlementConsole.innerHTML = `
    <div class="exchange-account-row">
      <div>
        <span class="eyebrow">Active trader</span>
        <strong>${escapeHtml(accountLabel)}</strong>
      </div>
      <div class="account-switch">
        <button class="terminal-button ${state.exchangeUserId === "trader-a" ? "active" : ""}" type="button" id="compactTraderA">Trader A</button>
        <button class="terminal-button ${state.exchangeUserId === "trader-b" ? "active" : ""}" type="button" id="compactTraderB">Trader B</button>
      </div>
    </div>
    <div class="metric-grid exchange-metrics">
      <div class="metric"><span>Balance</span><strong>${escapeHtml(user ? usdc(user.balance) : "--")}</strong></div>
      <div class="metric"><span>P&L</span><strong class="${Number(user?.pnl || 0) >= 0 ? "positive" : "negative"}">${escapeHtml(user ? usdc(user.pnl) : "--")}</strong></div>
    </div>
    <div class="settlement-row"><span>Outcome</span><strong>${escapeHtml(market.selection)}</strong></div>
    <div class="settlement-row"><span>Reference price</span><strong>${preciseOdds(market.currentOddsDecimal)}</strong></div>
    <div class="compact-trade-actions">
      <button class="terminal-button primary" type="button" id="openTradeTicketPanel">Open Trade Ticket</button>
      <button class="terminal-button" type="button" id="openSelectedWagerChart">Chart</button>
    </div>
    ${state.exchangeNotice ? `<div class="exchange-notice">${escapeHtml(state.exchangeNotice)}</div>` : ""}
    <div class="exchange-book">
      <section>
        <h3>Back Book</h3>
        ${renderBookLevels(book.back, "back")}
      </section>
      <section>
        <h3>Lay Book</h3>
        ${renderBookLevels(book.lay, "lay")}
      </section>
    </div>
    <section class="exchange-section">
      <h3>${escapeHtml(accountLabel)} Open Orders</h3>
      ${renderOpenOrders((portfolio?.openOrders || []).filter((order) => order.marketId === market.id))}
    </section>
    <section class="exchange-section">
      <h3>Matched Trades</h3>
      ${renderTradeRows(book.trades || [])}
    </section>
  `;

  qs("#openTradeTicketPanel")?.addEventListener("click", openExchangeTicket);
  qs("#openSelectedWagerChart")?.addEventListener("click", () => navigateToWager(market.id));
  qs("#compactTraderA")?.addEventListener("click", () => switchExchangeUser("trader-a"));
  qs("#compactTraderB")?.addEventListener("click", () => switchExchangeUser("trader-b"));
  bindCancelOrderButtons();
}

function renderTradeTicketOverlay() {
  const market = selectedMarket();

  if (!state.tradeTicketOpen) {
    els.tradeTicketOverlay.classList.remove("open");
    els.tradeTicketOverlay.innerHTML = "";
    return;
  }

  els.tradeTicketOverlay.classList.add("open");

  if (!market) {
    els.tradeTicketOverlay.innerHTML = `
      <div class="trade-modal" role="dialog" aria-modal="true" aria-labelledby="tradeTicketTitle">
        <div class="trade-modal-head">
          <div>
            <span class="eyebrow">P2P EXCHANGE</span>
            <h2 id="tradeTicketTitle">Trade Ticket</h2>
          </div>
          <button class="terminal-button" type="button" data-close-trade-ticket>Close</button>
        </div>
        <div class="empty-state">Select a wager before placing a trade.</div>
      </div>
    `;
    return;
  }

  setExchangeTicketDefaults(market);

  const history = sortedPriceHistory(state.oddsHistory.get(market.id) || []);
  const stats = priceHistoryStats(history);
  const portfolio = state.exchangePortfolio;
  const user = portfolio?.user;
  const book = state.exchangeOrderBook?.marketId === market.id ? state.exchangeOrderBook : { back: [], lay: [], trades: [] };
  const ticket = state.exchangeTicket;
  const orderType = ticket.orderType || "limit";
  const exposure = tradeExposure(ticket.side, ticket.odds, ticket.stake);
  const accountLabel = state.exchangeUserId === "trader-a" ? "Trader A" : "Trader B";
  const lastMove = stats.lastDelta;
  const placeVerb = orderType === "market" ? "Market" : ticket.side === "back" ? "Back" : "Lay";
  const orderTypeHelp = orderType === "market"
    ? "Crosses the best available opposite-side liquidity immediately. Unfilled size does not rest."
    : "Posts at your selected odds and rests unmatched size in the open order book.";

  els.tradeTicketOverlay.innerHTML = `
    <div class="trade-modal" role="dialog" aria-modal="true" aria-labelledby="tradeTicketTitle">
      <div class="trade-modal-head">
        <div>
          <span class="eyebrow">P2P EXCHANGE</span>
          <h2 id="tradeTicketTitle">Trade Ticket</h2>
        </div>
        <button class="terminal-button" type="button" data-close-trade-ticket>Close</button>
      </div>

      <div class="trade-modal-body">
        <section class="trade-ticket-panel order-panel">
          <div class="trade-ticket-section-head">
            <span class="eyebrow">Execution</span>
            <strong>${escapeHtml(accountLabel)}</strong>
          </div>
          <div class="account-switch wide">
            <button class="terminal-button ${state.exchangeUserId === "trader-a" ? "active" : ""}" type="button" id="traderA">Trader A</button>
            <button class="terminal-button ${state.exchangeUserId === "trader-b" ? "active" : ""}" type="button" id="traderB">Trader B</button>
          </div>
          <div class="metric-grid exchange-metrics">
            <div class="metric"><span>Balance</span><strong>${escapeHtml(user ? usdc(user.balance) : "--")}</strong></div>
            <div class="metric"><span>P&L</span><strong class="${Number(user?.pnl || 0) >= 0 ? "positive" : "negative"}">${escapeHtml(user ? usdc(user.pnl) : "--")}</strong></div>
          </div>
          <div class="trade-market-summary">
            <span>${escapeHtml(market.groupLabel || "Market")}</span>
            <strong>${escapeHtml(market.selection)}</strong>
            <small>${escapeHtml(state.match?.label || market.fixtureId)} / ${escapeHtml(market.periodLabel || "Full Match")}</small>
          </div>
          <div class="side-toggle trade-side-toggle">
            <button class="terminal-button ${orderType === "limit" ? "active" : ""}" type="button" id="exchangeLimit">Limit</button>
            <button class="terminal-button ${orderType === "market" ? "active" : ""}" type="button" id="exchangeMarket">Market</button>
          </div>
          <div class="trade-help">${escapeHtml(orderTypeHelp)}</div>
          <div class="side-toggle trade-side-toggle">
            <button class="terminal-button ${ticket.side === "back" ? "active back" : ""}" type="button" id="exchangeBack">Back</button>
            <button class="terminal-button ${ticket.side === "lay" ? "active lay" : ""}" type="button" id="exchangeLay">Lay</button>
          </div>
          <div class="trade-input-grid">
            <label>
              <span>Odds</span>
              <input id="exchangeOdds" type="number" min="1.01" step="0.001" value="${escapeHtml(ticket.odds)}">
            </label>
            <label>
              <span>Stake</span>
              <input id="exchangeStake" type="number" min="1" step="1" value="${escapeHtml(ticket.stake)}">
            </label>
          </div>
          <div class="settlement-row"><span>Required escrow</span><strong>${escapeHtml(usdc(exposure))}</strong></div>
          <button class="terminal-button primary place-order-button" type="button" id="placeExchangeOrder">
            ${state.exchangeBusy ? "Working" : `${placeVerb} ${escapeHtml(market.selection)}`}
          </button>
          ${state.exchangeNotice ? `<div class="exchange-notice">${escapeHtml(state.exchangeNotice)}</div>` : ""}
          <button class="terminal-button" type="button" id="cashOutExchangePosition">
            Cash Out Position
          </button>
          <button class="terminal-button settle-market-button" type="button" id="settleExchangeMarket">
            Settle As ${escapeHtml(market.selection)}
          </button>
        </section>

        <section class="trade-ticket-panel trade-chart-panel">
          <div class="trade-ticket-section-head">
            <span class="eyebrow">Price Context</span>
            <strong>${preciseOdds(market.currentOddsDecimal)}</strong>
          </div>
          <div class="metric-grid trade-stat-grid">
            <div class="metric"><span>Implied</span><strong>${pct(market.impliedProbability)}</strong></div>
            <div class="metric"><span>Last Tick</span><strong class="${valueClass(lastMove)}">${signedDecimal(lastMove)}</strong></div>
            <div class="metric"><span>High</span><strong>${preciseOdds(stats.max)}</strong></div>
            <div class="metric"><span>Low</span><strong>${preciseOdds(stats.min)}</strong></div>
          </div>
          <div class="trade-ticket-chart">
            ${history.length ? renderPriceChartSvg(history, { width: 720, height: 300, pad: 28, labelSize: 11 }) : `<div class="empty-state">Awaiting TxODDS price history for this wager.</div>`}
          </div>
        </section>

        <section class="trade-ticket-panel book-panel">
          <div class="trade-ticket-section-head">
            <span class="eyebrow">Order Book</span>
            <strong>5% rake</strong>
          </div>
          <div class="exchange-book">
            <section>
              <h3>Back Book</h3>
              ${renderBookLevels(book.back, "back")}
            </section>
            <section>
              <h3>Lay Book</h3>
              ${renderBookLevels(book.lay, "lay")}
            </section>
          </div>
          <section class="exchange-section">
            <h3>${escapeHtml(accountLabel)} Open Orders</h3>
            ${renderOpenOrders((portfolio?.openOrders || []).filter((order) => order.marketId === market.id))}
          </section>
          <section class="exchange-section">
            <h3>Matched Trades</h3>
            ${renderTradeRows(book.trades || [])}
          </section>
        </section>
      </div>
    </div>
  `;

  bindExchangeControls();
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

function log(kind = "", text = "") {
  void kind;
  void text;
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message || error)}</pre>`;
});
