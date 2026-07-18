import { pickNumber, pickString, pickValue, toFiniteNumber } from "./utils.js";
import { parseSseData } from "./sse.js";

function parseBoolean(value = true) {
  const normalized = String(value).trim().toLowerCase();

  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (["false", "0", "no"].includes(normalized)) return false;
  if (["true", "1", "yes"].includes(normalized)) return true;

  return true;
}

function sportNameFromId(value = "") {
  const sportId = String(value || "");

  switch (sportId) {
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
      return sportId ? `Sport ${sportId}` : "Unknown";
  }
}

function normalizeParticipantName(value = "") {
  return String(value)
    .replace("part1", "Participant 1")
    .replace("part2", "Participant 2");
}

function getParticipantNames(payload = {}) {
  const participant1 = pickString(payload, [
    "Participant1",
    "participant1",
    "participant1Name",
    "Participant1Name",
    "HomeTeam",
    "homeTeam"
  ], "Participant 1");
  const participant2 = pickString(payload, [
    "Participant2",
    "participant2",
    "participant2Name",
    "Participant2Name",
    "AwayTeam",
    "awayTeam"
  ], "Participant 2");

  return { participant1, participant2 };
}

function participant1IsHome(payload = {}) {
  const value = pickValue(payload, ["Participant1IsHome", "participant1IsHome"]);
  return value === undefined ? true : parseBoolean(value);
}

function getTeams(payload = {}) {
  const names = getParticipantNames(payload);
  const isParticipant1Home = participant1IsHome(payload);

  return {
    home: isParticipant1Home ? names.participant1 : names.participant2,
    away: isParticipant1Home ? names.participant2 : names.participant1
  };
}

function totalGoals(score = {}) {
  return toFiniteNumber(pickValue(score, [
    "Total.Goals",
    "total.goals",
    "Goals",
    "goals"
  ]));
}

function scoreFromSoccerPayload(payload = {}) {
  const scoreSoccer = pickValue(payload, [
    "scoreSoccer",
    "ScoreSoccer",
    "score_soccer",
    "Data.scoreSoccer",
    "data.scoreSoccer"
  ]);
  const participant1 = scoreSoccer ? totalGoals(scoreSoccer.Participant1 || scoreSoccer.participant1) : undefined;
  const participant2 = scoreSoccer ? totalGoals(scoreSoccer.Participant2 || scoreSoccer.participant2) : undefined;
  const isParticipant1Home = participant1IsHome(payload);

  if (Number.isFinite(participant1) && Number.isFinite(participant2)) {
    return {
      home: isParticipant1Home ? participant1 : participant2,
      away: isParticipant1Home ? participant2 : participant1
    };
  }

  return undefined;
}

function statNumber(stats = {}, statKeys = []) {
  const normalizedKeys = statKeys.map((key) => String(key));

  if (Array.isArray(stats)) {
    for (const stat of stats) {
      const statKey = pickValue(stat, ["key", "Key", "statKey", "StatKey", "id", "Id", "statId", "StatId"]);
      const statValue = pickValue(stat, ["value", "Value", "statValue", "StatValue", "total", "Total"]);

      if (normalizedKeys.includes(String(statKey))) {
        return toFiniteNumber(statValue);
      }
    }

    return undefined;
  }

  for (const key of normalizedKeys) {
    const value = stats[key];

    if (value && typeof value === "object") {
      return toFiniteNumber(pickValue(value, ["value", "Value", "total", "Total", "goals", "Goals"]));
    }

    if (value !== undefined && value !== null) {
      return toFiniteNumber(value);
    }
  }

  return undefined;
}

function scoreFromStats(payload = {}) {
  const stats = pickValue(payload, ["stats", "Stats", "Data.stats", "data.stats"]) || {};
  const participant1 = statNumber(stats, [1, 1001, 3001]);
  const participant2 = statNumber(stats, [2, 1002, 3002]);
  const isParticipant1Home = participant1IsHome(payload);

  if (Number.isFinite(participant1) && Number.isFinite(participant2)) {
    return {
      home: isParticipant1Home ? participant1 : participant2,
      away: isParticipant1Home ? participant2 : participant1
    };
  }

  return undefined;
}

function scoreFromFlatPayload(payload = {}) {
  const homeScore = toFiniteNumber(pickValue(payload, [
    "HomeScore",
    "homeScore",
    "Score.Home",
    "score.home",
    "Data.HomeScore",
    "data.homeScore"
  ]));
  const awayScore = toFiniteNumber(pickValue(payload, [
    "AwayScore",
    "awayScore",
    "Score.Away",
    "score.away",
    "Data.AwayScore",
    "data.awayScore"
  ]));
  const participant1 = toFiniteNumber(pickValue(payload, [
    "Participant1Score",
    "participant1Score"
  ]));
  const participant2 = toFiniteNumber(pickValue(payload, [
    "Participant2Score",
    "participant2Score"
  ]));
  const isParticipant1Home = participant1IsHome(payload);

  if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
    return { home: homeScore, away: awayScore };
  }

  if (Number.isFinite(participant1) && Number.isFinite(participant2)) {
    return {
      home: isParticipant1Home ? participant1 : participant2,
      away: isParticipant1Home ? participant2 : participant1
    };
  }

  return undefined;
}

function getScore(payload = {}) {
  return scoreFromSoccerPayload(payload) ||
    scoreFromStats(payload) ||
    scoreFromFlatPayload(payload);
}

function getMatchClock(payload = {}) {
  const soccerData = pickValue(payload, ["dataSoccer", "DataSoccer", "data", "Data"]) || {};
  const minuteValue = pickValue(payload, [
    "Minute",
    "minute",
    "Minutes",
    "minutes",
    "Clock.Minute",
    "clock.minute",
    "MatchMinute",
    "dataSoccer.Minutes",
    "DataSoccer.Minutes",
    "data.Minutes",
    "Data.Minutes"
  ]);
  const status = pickString(payload, [
    "statusSoccerId",
    "StatusSoccerId",
    "statusId",
    "StatusId",
    "Data.StatusId",
    "data.StatusId",
    "dataSoccer.StatusId",
    "DataSoccer.StatusId"
  ], "");
  const minute = toFiniteNumber(minuteValue, 0);
  const rawPeriod = pickString(payload, [
    "Period",
    "period",
    "GamePhase",
    "gamePhase",
    "Phase",
    "phase"
  ], "");
  const statusUpper = status.toUpperCase();
  const periodUpper = rawPeriod.toUpperCase();

  if (statusUpper === "END" || statusUpper === "F2" || status === "100") {
    return { minute: 90, period: "FT" };
  }

  if (statusUpper === "HT2" || periodUpper === "HT") {
    return { minute: 45, period: "HT" };
  }

  if (statusUpper === "H21" || periodUpper === "H2") {
    return { minute, period: "H2" };
  }

  if (statusUpper === "H11" || periodUpper === "H1") {
    return { minute, period: "H1" };
  }

  if (minuteValue !== undefined || soccerData.Minutes !== undefined || soccerData.minutes !== undefined) {
    return { minute, period: minute > 45 ? "H2" : "H1" };
  }

  return { minute, period: "NS" };
}

export function classifyScoreAction(raw = {}) {
  const action = pickString(raw, [
    "action",
    "Action",
    "dataSoccer.Action",
    "DataSoccer.Action",
    "data.Action",
    "Data.Action",
    "event",
    "Event",
    "eventType",
    "EventType"
  ], "match_status").toLowerCase();

  if (action.includes("goal")) return "goal";
  if (action.includes("card")) return "card";
  if (action.includes("substitution")) return "substitution";
  if (action.includes("var")) return "var";
  return "match_status";
}

export function normalizeTxlineScoreMessage(raw = {}, message = {}) {
  const payload = raw && typeof raw === "object" ? raw : { value: raw };
  const fixtureId = pickString(payload, ["FixtureId", "fixtureId", "fixtureID", "fixture_id"], "live");
  const seq = pickNumber(payload, ["Seq", "seq", "Sequence", "sequence"], Date.now());
  const action = pickString(payload, ["Action", "action", "dataSoccer.Action", "DataSoccer.Action"], message.event || "score");
  const actorName = pickString(payload, [
    "PlayerName",
    "playerName",
    "Data.PlayerName",
    "data.playerName",
    "DataSoccer.PlayerName",
    "dataSoccer.PlayerName"
  ], "");
  const actorTeamRaw = pickString(payload, ["Team", "team", "Participant", "participant", "Data.Participant", "dataSoccer.Participant"], "");
  const actorTeam = actorTeamRaw === "2" || actorTeamRaw.toLowerCase().includes("away") ? "away" : "home";
  const score = getScore(payload);
  const scoreStatus = score === undefined ? "unavailable" : "available";

  return {
    id: `txline:${fixtureId}:${seq}`,
    source: "txline-live",
    fixtureId,
    seq,
    txlineEventName: message.event,
    type: action === "game_finalised" ? "match_status" : classifyScoreAction(payload),
    ts: new Date().toISOString(),
    matchClock: getMatchClock(payload),
    teams: getTeams(payload),
    scoreStatus,
    score,
    actor: actorName ? { playerName: actorName, team: actorTeam } : undefined,
    payload
  };
}

function expandTxlineOddsRow(row = {}) {
  const prices = row.Prices || row.prices;
  const names = row.PriceNames || row.priceNames;
  const pct = row.Pct || row.pct || [];

  if (Array.isArray(prices) && Array.isArray(names)) {
    return prices.map((price, index) => ({
      ...row,
      Id: `${row.MessageId || row.messageId || row.FixtureId || "market"}:${names[index] || index}`,
      Selection: names[index] || `selection_${index + 1}`,
      Decimal: Number(price) / 1000,
      PctValue: pct[index]
    }));
  }

  return [row];
}

function extractOddsEntries(raw = {}) {
  if (Array.isArray(raw)) return raw.flatMap(expandTxlineOddsRow);
  if (!raw || typeof raw !== "object") return [];

  for (const key of ["markets", "Markets", "odds", "Odds", "data", "Data"]) {
    const value = raw[key];

    if (Array.isArray(value)) {
      return value.flatMap((entry) => (
        entry && typeof entry === "object" ? expandTxlineOddsRow(entry) : []
      ));
    }
  }

  if (
    pickValue(raw, ["Decimal", "decimal", "DecimalOdds", "decimalOdds", "Price", "price", "Odds", "odds", "Prices"]) !== undefined
  ) {
    return expandTxlineOddsRow(raw);
  }

  return [];
}

function normalizeTxlineOddsEntry(entry = {}, index = 0, fixtureId = "live") {
  const marketType = pickString(entry, [
    "SuperOddsType",
    "superOddsType",
    "MarketType",
    "marketType",
    "type"
  ], "market");
  const selection = normalizeParticipantName(pickString(entry, [
    "Selection",
    "selection",
    "Outcome",
    "outcome",
    "Participant",
    "participant",
    "Name",
    "name"
  ], `${marketType} ${index + 1}`));
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

export function normalizeTxlineOddsMessage(raw = {}, message = {}) {
  const payload = raw && typeof raw === "object" ? raw : { value: raw };
  const fixtureId = pickString(payload, ["FixtureId", "fixtureId", "FixtureID", "fixture_id"], "live");
  const seq = pickNumber(payload, ["Seq", "seq", "Sequence", "sequence"], Date.now());
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
    teams: getTeams(payload),
    score: undefined,
    payload: {
      reason: "TxODDS StablePrice update",
      markets,
      raw: payload
    }
  };
}

export function normalizeTxlineStreamMessage(channel = "scores", message = {}) {
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
      scoreStatus: "unavailable",
      payload: { channel }
    };
  }

  return channel === "odds"
    ? normalizeTxlineOddsMessage(data, message)
    : normalizeTxlineScoreMessage(data, message);
}

export function latestScoredEvent(records = []) {
  const normalized = records
    .map((record) => normalizeTxlineScoreMessage(record))
    .filter((event) => event.score !== undefined);

  return normalized.sort((a, b) => Number(b.seq) - Number(a.seq))[0];
}

export function normalizeTxlineFixtureRow(fixture = {}) {
  const fixtureId = pickString(fixture, ["FixtureId", "fixtureId", "Id", "id"], "");
  const teams = getTeams(fixture);
  const sportId = pickValue(fixture, [
    "SportId",
    "sportId"
  ]);
  const sport = pickString(fixture, ["Sport", "sport", "SportName", "sportName"], sportNameFromId(sportId));

  return {
    fixtureId,
    label: `${teams.home} vs ${teams.away}`,
    competition: pickString(fixture, [
      "CompetitionName",
      "competitionName",
      "Competition",
      "competition"
    ], "TxODDS fixture"),
    round: pickString(fixture, [
      "FixtureGroup",
      "fixtureGroup",
      "Round",
      "round"
    ], "Live fixture"),
    venue: pickString(fixture, ["Venue", "venue"], "TxLINE"),
    startTime: pickString(fixture, ["StartTime", "startTime"], ""),
    sport,
    teams,
    raw: fixture
  };
}
