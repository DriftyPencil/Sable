import { getTxlineConfig, getTxlineHeaders, requireTxlineCredentials } from "./config.js";
import { latestScoredEvent, normalizeTxlineFixtureRow } from "./txline-normalizers.js";

export async function fetchTxlineJson(apiPath = "", searchParams = undefined) {
  const config = requireTxlineCredentials();
  const url = new URL(`${config.apiBase}${apiPath}`);
  const headers = getTxlineHeaders();
  let body = null;

  if (searchParams) {
    for (const [key, value] of searchParams) {
      if (value !== "") url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, { headers });
  const bodyText = await response.text();

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

export { fetchTxlineJson as txlineJson };

export async function fetchTxlineFixtures(searchParams = undefined) {
  const rows = await fetchTxlineJson("/fixtures/snapshot", searchParams);
  return dedupeFixtureRows(rows);
}

export async function fetchTxlineOdds(fixtureId = "") {
  return fetchTxlineJson(`/odds/snapshot/${encodeURIComponent(fixtureId)}`);
}

function fixtureIdFromRow(row = {}) {
  return String(row.FixtureId || row.fixtureId || row.FixtureID || row.fixture_id || "");
}

function oddsRowTimestamp(row = {}) {
  const value = Number(row.Ts || row.ts || row.Timestamp || row.timestamp || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function hourlyOddsBuckets(referenceMs = Date.now(), hoursBack = 2) {
  const cappedHoursBack = Math.min(Math.max(Number(hoursBack) || 0, 0), 12);
  const reference = new Date(referenceMs);
  const hourStartMs = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
    reference.getUTCHours()
  );
  const buckets = [];

  for (let offset = cappedHoursBack; offset >= 0; offset -= 1) {
    const bucketMs = hourStartMs - offset * 60 * 60 * 1000;
    const bucketDate = new Date(bucketMs);

    buckets.push({
      epochDay: Math.floor(bucketMs / 86400000),
      hourOfDay: bucketDate.getUTCHours()
    });
  }

  return buckets;
}

function dedupeOddsRows(rows = []) {
  const byKey = new Map();

  for (const row of rows) {
    const key = [
      row.MessageId || row.messageId || "",
      row.Ts || row.ts || "",
      row.FixtureId || row.fixtureId || "",
      row.SuperOddsType || row.superOddsType || "",
      row.MarketPeriod || row.marketPeriod || "",
      row.MarketParameters || row.marketParameters || ""
    ].join("|");

    byKey.set(key, row);
  }

  return [...byKey.values()].sort((a, b) => oddsRowTimestamp(a) - oddsRowTimestamp(b));
}

export async function fetchTxlineOddsHistory(fixtureId = "", options = {}) {
  const hoursBack = Number(options.hoursBack ?? options.hours ?? 2);
  const interval = Number(options.interval ?? 0);
  const snapshotRows = await fetchTxlineOdds(fixtureId);
  const snapshot = Array.isArray(snapshotRows) ? snapshotRows : [];
  const latestSnapshotTs = Math.max(0, ...snapshot.map(oddsRowTimestamp));
  const referenceMs = latestSnapshotTs || Date.now();
  const bucketResults = await Promise.all(hourlyOddsBuckets(referenceMs, hoursBack).map(async (bucket) => {
    const path = `/odds/updates/${bucket.epochDay}/${bucket.hourOfDay}/${interval}`;

    try {
      const rows = await fetchTxlineJson(path);
      const bucketRows = Array.isArray(rows)
        ? rows.filter((row) => fixtureIdFromRow(row) === fixtureId)
        : [];

      return {
        attempt: {
          path,
          status: "ok",
          count: bucketRows.length
        },
        rows: bucketRows
      };
    } catch (error) {
      return {
        attempt: {
          path,
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        },
        rows: []
      };
    }
  }));
  const attempts = bucketResults.map((result) => result.attempt);
  const updateRows = bucketResults.flatMap((result) => result.rows);

  return {
    fixtureId,
    interval,
    hoursBack,
    snapshotRowCount: snapshot.length,
    updateRowCount: updateRows.length,
    attempts,
    rows: dedupeOddsRows([...updateRows, ...snapshot])
  };
}

async function fetchScoreAttempt(label = "", apiPath = "") {
  let records = [];
  let error = "";

  try {
    const result = await fetchTxlineJson(apiPath);
    records = Array.isArray(result) ? result : [];
  } catch (caughtError) {
    error = caughtError instanceof Error ? caughtError.message : String(caughtError);
  }

  return {
    label,
    path: apiPath,
    count: records.length,
    error,
    records
  };
}

function scoreAttemptsForFixture(fixtureId = "") {
  const encodedFixtureId = encodeURIComponent(fixtureId);

  return [
    {
      label: "snapshot",
      path: `/scores/snapshot/${encodedFixtureId}`
    },
    {
      label: "updates",
      path: `/scores/updates/${encodedFixtureId}`
    },
    {
      label: "historical",
      path: `/scores/historical/${encodedFixtureId}`
    }
  ];
}

export async function fetchTxlineScoresWithStatus(fixtureId = "") {
  const attempts = [];
  const paths = scoreAttemptsForFixture(fixtureId);
  let fallbackSelected = null;
  let latestEvent = undefined;
  let selected = null;

  for (const item of paths) {
    const attempt = await fetchScoreAttempt(item.label, item.path);
    const attemptLatestEvent = latestScoredEvent(attempt.records);

    attempts.push({
      label: attempt.label,
      path: attempt.path,
      count: attempt.count,
      error: attempt.error
    });

    if (!selected && attemptLatestEvent) {
      selected = attempt;
      latestEvent = attemptLatestEvent;
    }

    if (!fallbackSelected && attempt.records.length > 0) {
      fallbackSelected = attempt;
    }
  }

  return {
    fixtureId,
    scoreStatus: latestEvent ? "available" : "unavailable",
    source: selected?.label || fallbackSelected?.label || null,
    records: selected?.records || fallbackSelected?.records || [],
    latestEvent: latestEvent || null,
    attempts,
    message: latestEvent
      ? "TxODDS returned a score-bearing payload for this fixture."
      : "TxODDS returned no score-bearing payload for this fixture; Sable will not synthesize a 0-0 score."
  };
}

export async function fetchTxlineScoreRecords(fixtureId = "") {
  const status = await fetchTxlineScoresWithStatus(fixtureId);
  return status.records;
}

export async function fetchLatestScoredEvent(fixtureId = "") {
  const status = await fetchTxlineScoresWithStatus(fixtureId);
  return status.latestEvent || undefined;
}

export function liveStatusPayload() {
  const config = getTxlineConfig();

  return {
    network: config.network,
    apiBase: config.apiBase,
    guestAuth: config.guestAuth,
    programId: config.programId,
    hasGuestJwt: Boolean(config.jwt),
    hasApiToken: Boolean(config.apiToken),
    fixtureSnapshotPath: "/fixtures/snapshot",
    fixtureSportFilter: null,
    streamPaths: ["/scores/stream", "/odds/stream"],
    liveReady: config.hasCredentials
  };
}

export async function attachFixtureScoreSnapshots(fixtures = [], limit = 20) {
  const rows = Array.isArray(fixtures) ? fixtures : [];
  const cappedRows = rows.slice(0, Math.max(0, Number(limit) || 0));
  const scoreByFixtureId = new Map();

  for (const fixture of cappedRows) {
    const normalizedFixture = normalizeTxlineFixtureRow(fixture);

    if (normalizedFixture.fixtureId) {
      scoreByFixtureId.set(
        normalizedFixture.fixtureId,
        await fetchTxlineScoresWithStatus(normalizedFixture.fixtureId)
      );
    }
  }

  return rows.map((fixture) => {
    const normalizedFixture = normalizeTxlineFixtureRow(fixture);
    const score = scoreByFixtureId.get(normalizedFixture.fixtureId);

    return score
      ? {
        ...fixture,
        SableScoreStatus: score.scoreStatus,
        SableLatestScoreEvent: score.latestEvent,
        SableScoreSource: score.source,
        SableScoreAttempts: score.attempts
      }
      : fixture;
  });
}

export function dedupeFixtureRows(fixtures = []) {
  const rows = Array.isArray(fixtures) ? fixtures : [];
  const byFixtureId = new Map();
  const nowMs = Date.now();
  const liveGraceMs = 3 * 60 * 60 * 1000;

  for (const fixture of rows) {
    const normalizedFixture = normalizeTxlineFixtureRow(fixture);
    const existing = byFixtureId.get(normalizedFixture.fixtureId);
    const existingTs = Number(existing?.Ts || existing?.ts || 0);
    const nextTs = Number(fixture.Ts || fixture.ts || 0);

    if (!normalizedFixture.fixtureId) continue;

    if (!existing || nextTs >= existingTs) {
      byFixtureId.set(normalizedFixture.fixtureId, {
        ...fixture,
        SableSport: normalizedFixture.sport,
        SableLabel: normalizedFixture.label
      });
    }
  }

  return [...byFixtureId.values()]
    .filter((fixture) => {
      const startMs = Number(fixture.StartTime || fixture.startTime || 0);
      return Number.isFinite(startMs) && startMs >= nowMs - liveGraceMs;
    })
    .sort((a, b) => {
      const aStartMs = Number(a.StartTime || a.startTime || 0);
      const bStartMs = Number(b.StartTime || b.startTime || 0);
      return aStartMs - bStartMs;
    });
}
