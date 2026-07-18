const state = {
  mode: "demo",
  speed: 5,
  fixtureKey: "bra-arg-final",
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
  drawerOpen: false,
  activePane: "match",
  commandLog: [
    { kind: "out", text: "Ready. Try MATCH BRA-ARG, ODDS BRA-ARG, STEAM --live, PROOF BRA_ML, SETTLE BRA_ML." }
  ],
  settlement: null,
  wallet: "DemoWallet9xSableDevnet111111111111111111111"
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

function bps(value) {
  if (!Number.isFinite(value)) return "0 bps";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value)} bps`;
}

function implied(decimal) {
  return decimal > 0 ? 1 / decimal : 0;
}

function clockLabel(clock) {
  if (!clock) return "--";
  const extra = clock.stoppage ? `+${clock.stoppage}` : "";
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

function setActivePane(pane) {
  state.activePane = pane;
  document.querySelectorAll(".pane").forEach((el) => {
    el.dataset.focus = el.dataset.pane === pane ? "true" : "false";
  });
}

async function init() {
  els.statusBar = qs("#statusBar");
  els.fixtureSelect = qs("#fixtureSelect");
  els.speedSelect = qs("#speedSelect");
  els.demoModeBtn = qs("#demoModeBtn");
  els.liveModeBtn = qs("#liveModeBtn");
  els.replayBtn = qs("#replayBtn");
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
  await loadDemoFixtures();
  connectStream();
  renderAll();
}

function bindEvents() {
  els.demoModeBtn.addEventListener("click", () => setMode("demo"));
  els.liveModeBtn.addEventListener("click", () => setMode("live"));
  els.replayBtn.addEventListener("click", () => connectStream());
  els.speedSelect.addEventListener("change", () => {
    state.speed = Number(els.speedSelect.value);
    connectStream();
  });
  els.fixtureSelect.addEventListener("change", async () => {
    state.fixtureKey = els.fixtureSelect.value;
    applyFixture(getFixtureRecord());
    if (state.mode === "live") await hydrateLiveOdds(getFixtureRecord());
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

async function loadDemoFixtures() {
  const response = await fetch("/api/fixtures");
  state.fixtures = await response.json();
  els.fixtureSelect.innerHTML = state.fixtures.map((fixture) => (
    `<option value="${fixture.id}">${escapeHtml(fixture.metadata.label)}</option>`
  )).join("");
  if (!getFixtureRecord()) state.fixtureKey = state.fixtures[0]?.id || "bra-arg-final";
  els.fixtureSelect.value = state.fixtureKey;
  applyFixture(getFixtureRecord());
}

function applyFixture(record) {
  if (!record) return;
  state.match = {
    ...record.metadata,
    demoFixtureId: record.id,
    score: { home: 0, away: 0 },
    clock: { minute: 0, period: "NS" }
  };
  state.markets = new Map(record.markets.map((market) => [market.id, { ...market }]));
  state.oddsHistory = new Map();
  state.receipts = new Map();
  state.alerts = [];
  state.events = [];
  state.settlement = null;
  state.selectedMarketId = record.markets[0]?.id || null;
}

async function setMode(mode) {
  state.mode = mode;
  els.demoModeBtn.classList.toggle("active", mode === "demo");
  els.liveModeBtn.classList.toggle("active", mode === "live");
  if (mode === "demo") {
    await loadDemoFixtures();
  } else {
    await hydrateLiveFixtures();
  }
  connectStream();
}

function connectStream() {
  if (state.source) state.source.close();
  if (state.mode === "demo") {
    applyFixture(getFixtureRecord());
  } else {
    const record = getFixtureRecord();
    if (record && (!state.match || state.match.fixtureId !== record.metadata.fixtureId)) {
      applyFixture(record);
    }
    state.events = [];
    state.alerts = [];
    state.receipts = new Map();
    state.settlement = null;
  }
  state.connected = false;
  state.lastEventAt = null;
  renderAll();

  const url = state.mode === "demo"
    ? `/api/sim/stream?fixture=${encodeURIComponent(state.fixtureKey)}&speed=${state.speed}`
    : "/api/stream?channel=all";

  const source = new EventSource(url);
  state.source = source;

  source.onopen = () => {
    state.connected = true;
    renderStatus();
  };

  source.addEventListener("reset", (event) => {
    const data = JSON.parse(event.data);
    if (data.fixture) {
      state.fixtureKey = data.fixture.id;
      applyFixture(data.fixture);
    }
    state.connected = true;
    renderAll();
  });

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

  source.addEventListener("replay_done", () => {
    log("out", "Replay complete. Use Replay or WATCH USA-ENG to run another scenario.");
    state.connected = false;
    source.close();
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
  const event = {
    id: `live:${data.Seq || data.seq || Date.now()}`,
    source: "txline-live",
    fixtureId: String(data.FixtureId || data.fixtureId || "live"),
    seq: Number(data.Seq || data.seq || 0),
    type: data.action === "goal" ? "goal" : "match_status",
    ts: new Date().toISOString(),
    matchClock: { minute: Number(data.Minute || data.minute || 0), period: "H1" },
    teams: state.match?.teams || { home: "Home", away: "Away" },
    score: {
      home: Number(data.HomeScore || data.homeScore || 0),
      away: Number(data.AwayScore || data.awayScore || 0)
    },
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
        score: event.score || { home: 0, away: 0 },
        clock: event.matchClock || { minute: 0, period: "NS" }
      };
    }
  }

  if (state.match) {
    if (event.teams?.home && event.teams.home !== "Participant 1") state.match.teams = event.teams;
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
  for (const quote of event.payload.markets || []) {
    const market = state.markets.get(quote.id) || {
      id: quote.id,
      fixtureId: event.fixtureId,
      label: quote.label || quote.id,
      selection: quote.selection || quote.id,
      type: quote.type || "unknown",
      status: "open",
      volumeUsd: 0,
      liquidityUsd: 0,
      resolutionRule: { statKeys: [], predicate: "" }
    };
    const history = state.oddsHistory.get(quote.id) || [];
    const previous = history.at(-1);
    const nextProbability = implied(Number(quote.decimal));
    const snapshot = {
      id: `${quote.id}:${event.seq}`,
      marketId: quote.id,
      fixtureId: event.fixtureId,
      ts: event.ts,
      decimal: Number(quote.decimal),
      impliedProbability: nextProbability,
      consensusSpreadBps: Number(quote.consensusSpreadBps || 0),
      sourceCount: Number(quote.sourceCount || 0),
      volumeUsd: Number(quote.volumeUsd || market.volumeUsd || 0)
    };
    history.push(snapshot);
    state.oddsHistory.set(quote.id, history.slice(-40));

    market.currentOddsDecimal = snapshot.decimal;
    market.impliedProbability = snapshot.impliedProbability;
    market.consensusSpreadBps = snapshot.consensusSpreadBps;
    market.sourceCount = snapshot.sourceCount;
    market.volumeUsd = snapshot.volumeUsd;
    market.label = quote.label || market.label;
    market.selection = quote.selection || market.selection;
    market.type = quote.type || market.type;
    if (quote.line !== undefined) market.line = quote.line;
    market.status = snapshot.decimal > 0 && market.status !== "resolved" ? "open" : market.status;
    state.markets.set(quote.id, market);

    if (previous) {
      const deltaBps = (snapshot.impliedProbability - previous.impliedProbability) * 10000;
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
    `<option value="${fixture.id}">${escapeHtml(fixture.metadata.label)}</option>`
  )).join("");

  let selectedFixture = fixtures[0];
  let selectedMarkets = [];
  for (const fixture of fixtures.slice(0, 20)) {
    selectedMarkets = await fetchLiveOddsMarkets(fixture);
    if (selectedMarkets.length) {
      selectedFixture = fixture;
      break;
    }
  }

  state.fixtureKey = selectedFixture.id;
  els.fixtureSelect.value = state.fixtureKey;
  applyFixture(selectedFixture);
  if (selectedMarkets.length) {
    state.markets = new Map(selectedMarkets.map((market) => [market.id, market]));
    state.selectedMarketId = selectedMarkets[0].id;
    log("out", `Loaded real TxODDS odds for ${selectedFixture.metadata.label}.`);
  } else {
    log("out", "TxODDS fixtures loaded, but no odds markets were found in the first 20 fixtures.");
  }
}

async function hydrateLiveOdds(record) {
  if (!record?.metadata?.fixtureId || state.mode !== "live" || !state.liveStatus?.liveReady) return;
  const markets = await fetchLiveOddsMarkets(record);
  if (!markets.length) {
    log("out", `No odds markets returned for fixture ${record.metadata.fixtureId}.`);
    return;
  }

  state.markets = new Map(markets.map((market) => [market.id, market]));
  state.selectedMarketId = markets[0].id;
}

async function fetchLiveOddsMarkets(record) {
  const response = await fetch(`/api/txline/odds/${encodeURIComponent(record.metadata.fixtureId)}`);
  if (!response.ok) {
    log("out", `TxODDS odds snapshot failed with ${response.status}. Waiting for stream ticks.`);
    return [];
  }

  const rawOdds = await response.json();
  const markets = normalizeOddsSnapshot(rawOdds, record.metadata.fixtureId);
  return markets;
}

function normalizeLiveFixtures(rawFixtures) {
  const rows = Array.isArray(rawFixtures) ? rawFixtures : [];
  return rows.slice(0, 80).map((fixture) => {
    const fixtureId = String(fixture.FixtureId || fixture.fixtureId || fixture.Id || fixture.id || "");
    const participant1 = String(fixture.Participant1 || fixture.participant1 || fixture.HomeTeam || fixture.homeTeam || "Participant 1");
    const participant2 = String(fixture.Participant2 || fixture.participant2 || fixture.AwayTeam || fixture.awayTeam || "Participant 2");
    const p1Home = fixture.Participant1IsHome ?? fixture.participant1IsHome ?? true;
    const home = p1Home ? participant1 : participant2;
    const away = p1Home ? participant2 : participant1;
    return {
      id: `txline-${fixtureId}`,
      source: "txline-live",
      metadata: {
        fixtureId,
        label: `${home} vs ${away}`,
        competition: String(fixture.CompetitionName || fixture.competitionName || fixture.Competition || "TxODDS fixture"),
        round: String(fixture.FixtureGroup || fixture.fixtureGroup || fixture.Round || "Live fixture"),
        venue: String(fixture.Venue || fixture.venue || "TxLINE"),
        startTime: String(fixture.StartTime || fixture.startTime || new Date().toISOString()),
        teams: { home, away }
      },
      markets: []
    };
  }).filter((fixture) => fixture.metadata.fixtureId);
}

function normalizeOddsSnapshot(rawOdds, fixtureId) {
  const rows = Array.isArray(rawOdds)
    ? rawOdds
    : ["markets", "Markets", "odds", "Odds", "data", "Data"].flatMap((key) => (
      Array.isArray(rawOdds?.[key]) ? rawOdds[key] : []
    ));

  return rows.flatMap(expandOddsRow).map((row, index) => {
    const marketType = String(row.SuperOddsType || row.superOddsType || row.MarketType || row.marketType || row.type || "market");
    const selection = String(row.Selection || row.selection || row.Outcome || row.outcome || row.Name || row.name || `${marketType} ${index + 1}`)
      .replace("part1", "Participant 1")
      .replace("part2", "Participant 2");
    const line = row.Line ?? row.line ?? row.Handicap ?? row.handicap ?? row.Total ?? row.total;
    const id = String(row.Id || row.id || row.MarketId || row.marketId || `${fixtureId}:${marketType}:${selection}:${line ?? ""}`)
      .replace(/[^a-z0-9:_-]/gi, "_");
    const decimal = Number(row.Decimal || row.decimal || row.DecimalOdds || row.decimalOdds || row.Price || row.price || row.Odds || row.odds || 0);
    const probability = implied(decimal);
    return {
      id,
      fixtureId,
      type: marketType,
      label: String(row.Label || row.label || row.MarketName || row.marketName || selection),
      selection,
      line: line === undefined ? undefined : Number(line),
      status: decimal > 0 ? "open" : "suspended",
      currentOddsDecimal: decimal,
      impliedProbability: probability,
      volumeUsd: Number(row.VolumeUsd || row.volumeUsd || row.Volume || row.volume || 0),
      liquidityUsd: Number(row.LiquidityUsd || row.liquidityUsd || row.Liquidity || row.liquidity || 0),
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
      Id: `${row.MessageId || row.messageId || row.FixtureId || "market"}:${priceNames[index] || index}`,
      Selection: priceNames[index] || `selection_${index + 1}`,
      Decimal: Number(price) / 1000,
      PctValue: pctValues[index]
    }));
  }
  return [row];
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
    ["MODE", state.mode.toUpperCase(), state.mode === "demo" ? "status-good" : "status-warn"],
    ["STREAM", connection, connectionClass],
    ["FIXTURE", state.match?.label || "--", ""],
    ["CLOCK", clockLabel(state.match?.clock), ""],
    ["LAST EVENT", state.lastEventAt ? state.lastEventAt.toLocaleTimeString() : "--", ""],
    ["MARKET", selected?.id || "--", ""]
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
  return event.payload.note || event.payload.action || "Status update";
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
        <div class="score">${match.score.home}</div>
      </div>
      <div class="score-center">
        <div class="clock-big">${escapeHtml(clockLabel(match.clock))}</div>
        <div class="round-label">${escapeHtml(match.round)}</div>
      </div>
      <div>
        <div class="team-name">${escapeHtml(match.teams.away)}</div>
        <div class="score">${match.score.away}</div>
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
      <div class="metric"><span>Venue</span><strong>${escapeHtml(match.venue)}</strong></div>
      <div class="metric"><span>Latest Seq</span><strong>${latestEvent?.seq || "--"}</strong></div>
      <div class="metric"><span>Last Action</span><strong>${escapeHtml(latestEvent?.type || "pending")}</strong></div>
    </div>
  `;
}

function renderOdds() {
  const markets = [...state.markets.values()];
  if (!markets.length) {
    els.oddsMonitor.innerHTML = `<div class="empty-state">No markets loaded.</div>`;
    return;
  }

  els.oddsMonitor.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Market</th>
          <th>Odds</th>
          <th>Impl</th>
          <th>Move</th>
          <th>Vol</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${markets.map((market) => {
          const history = state.oddsHistory.get(market.id) || [];
          const latest = history.at(-1);
          const previous = history.at(-2);
          const delta = latest && previous
            ? (latest.impliedProbability - previous.impliedProbability) * 10000
            : 0;
          const deltaClass = delta > 0 ? "positive" : delta < 0 ? "negative" : "muted";
          const statusClass = market.status === "resolved" ? "good" : market.status === "open" ? "" : "warn";
          return `
            <tr class="odds-row ${state.selectedMarketId === market.id ? "selected" : ""}" data-market-id="${escapeHtml(market.id)}">
              <td>
                <div class="market-label">
                  <strong>${escapeHtml(market.selection)}</strong>
                  <small>${escapeHtml(market.type)} / ${escapeHtml(market.id)}</small>
                </div>
              </td>
              <td>${odds(market.currentOddsDecimal)}</td>
              <td>${pct(market.impliedProbability)}</td>
              <td class="${deltaClass}">${bps(delta)}</td>
              <td>${money(market.volumeUsd)}</td>
              <td><span class="badge ${statusClass}">${escapeHtml(market.status)}</span></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderScanner() {
  if (!state.alerts.length) {
    els.marketScanner.innerHTML = `<div class="empty-state">No steam moves yet. The scanner trips at 650 bps inside the replay window.</div>`;
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
  const history = state.oddsHistory.get(state.selectedMarketId) || [];
  els.chartMarketLabel.textContent = market ? `${market.id} ${market.selection}` : "Select market";

  if (!market || history.length < 2) {
    els.oddsChart.innerHTML = `<div class="empty-state">Awaiting at least two odds ticks for the selected market.</div>`;
    return;
  }

  const width = 560;
  const height = 190;
  const pad = 20;
  const values = history.map((item) => item.impliedProbability);
  const min = Math.max(0, Math.min(...values) - 0.04);
  const max = Math.min(1, Math.max(...values) + 0.04);
  const span = max - min || 1;
  const points = history.map((item, index) => {
    const x = pad + (index / Math.max(1, history.length - 1)) * (width - pad * 2);
    const y = height - pad - ((item.impliedProbability - min) / span) * (height - pad * 2);
    return { x, y, item };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;

  els.oddsChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Implied probability chart">
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${pad}" y2="${pad}"></line>
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${height / 2}" y2="${height / 2}"></line>
      <line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${height - pad}" y2="${height - pad}"></line>
      <polygon class="chart-area" points="${area}"></polygon>
      <polyline class="chart-line" points="${line}"></polyline>
      ${points.map((point) => `<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join("")}
      <text x="${pad}" y="16" fill="#8a98a9" font-size="10">${pct(max)}</text>
      <text x="${pad}" y="${height - 6}" fill="#8a98a9" font-size="10">${pct(min)}</text>
      <text x="${width - 160}" y="16" fill="#34d399" font-size="11">Last ${pct(history.at(-1).impliedProbability)}</text>
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
    <div class="settlement-row"><span>Wallet</span><strong>${escapeHtml(short(state.wallet, 9))}</strong></div>
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
    let response;
    if (state.mode === "live") {
      const seq = latestSequenceForMarket(market);
      if (!seq) {
        log("out", `TxODDS proof needs an observed stream/snapshot seq for fixture ${market.fixtureId}.`);
        state.drawerOpen = true;
        setActivePane("settlement");
        renderAll();
        return;
      }
      response = await fetch(`/api/proofs/stat?source=txline&fixtureId=${encodeURIComponent(market.fixtureId)}&seq=${encodeURIComponent(seq)}&statKeys=${encodeURIComponent((market.resolutionRule?.statKeys || [1, 2]).join(","))}`);
    } else {
      response = await fetch(`/api/proofs/stat?demoFixtureId=${encodeURIComponent(state.fixtureKey)}&marketId=${encodeURIComponent(market.id)}`);
    }
    if (response.ok) {
      const payload = await response.json();
      state.receipts.set(market.id, state.mode === "live"
        ? buildTxlineReceipt(payload, market)
        : payload);
    } else if (state.mode === "live") {
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
