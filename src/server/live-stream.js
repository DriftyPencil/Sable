import { getTxlineConfig, getTxlineHeaders, requireTxlineCredentials } from "./config.js";
import { parseSseBlock, sseHeaders, writeSse } from "./sse.js";
import { fetchLatestScoredEvent, fetchTxlineFixtures, fetchTxlineOdds } from "./txline-client.js";
import {
  normalizeTxlineFixtureRow,
  normalizeTxlineOddsMessage,
  normalizeTxlineStreamMessage
} from "./txline-normalizers.js";

function liveChannels(requestedChannel = "all") {
  if (requestedChannel === "all") return ["scores", "odds"];
  return [requestedChannel === "odds" ? "odds" : "scores"];
}

function scoreBootstrapLimit() {
  const configuredLimit = Number(process.env.SABLE_SCORE_BOOTSTRAP_LIMIT || 16);
  return Math.min(Math.max(configuredLimit, 0), 40);
}

function fixtureIdsFromRows(rows = [], limit = 16) {
  const ids = [];

  for (const fixture of rows.slice(0, limit)) {
    const normalizedFixture = normalizeTxlineFixtureRow(fixture);

    if (normalizedFixture.fixtureId) ids.push(normalizedFixture.fixtureId);
  }

  return ids;
}

function requestedFixtureId(searchParams = new URLSearchParams()) {
  return searchParams.get("fixtureId") || searchParams.get("fixture") || "";
}

async function fixtureIdsForBootstrap(searchParams = new URLSearchParams()) {
  const fixtureId = requestedFixtureId(searchParams);
  const limit = fixtureId ? 1 : scoreBootstrapLimit();
  const fixtures = fixtureId ? [] : await fetchTxlineFixtures();

  return fixtureId
    ? [fixtureId]
    : fixtureIdsFromRows(fixtures, limit);
}

function fixtureRowsForOddsBootstrap(fixtures = [], searchParams = new URLSearchParams()) {
  const fixtureId = requestedFixtureId(searchParams);
  const rows = Array.isArray(fixtures) ? fixtures : [];

  if (!fixtureId) return rows.slice(0, scoreBootstrapLimit());

  return rows.filter((fixture) => (
    normalizeTxlineFixtureRow(fixture).fixtureId === fixtureId
  ));
}

function oddsPayloadForFixture(fixture = {}, oddsRows = []) {
  const normalizedFixture = normalizeTxlineFixtureRow(fixture);

  return {
    FixtureId: normalizedFixture.fixtureId,
    Participant1: fixture.Participant1 || fixture.participant1 || normalizedFixture.teams.home,
    Participant2: fixture.Participant2 || fixture.participant2 || normalizedFixture.teams.away,
    Participant1IsHome: fixture.Participant1IsHome ?? fixture.participant1IsHome ?? true,
    markets: oddsRows
  };
}

async function emitInitialScoreSnapshots(res, searchParams = new URLSearchParams(), signal = new AbortController().signal) {
  const fixtureIds = await fixtureIdsForBootstrap(searchParams);
  const emitted = [];
  const missing = [];

  for (const fixtureId of fixtureIds) {
    const latestEvent = signal.aborted ? undefined : await fetchLatestScoredEvent(fixtureId);

    if (signal.aborted) return { emitted, missing };

    if (latestEvent) {
      emitted.push(fixtureId);
      writeSse(res, "match_event", {
        ...latestEvent,
        payload: {
          ...latestEvent.payload,
          reason: "TxODDS score snapshot bootstrap"
        }
      }, latestEvent.id);
    } else {
      missing.push(fixtureId);
    }
  }

  return { emitted, missing };
}

async function emitInitialOddsSnapshot(res, searchParams = new URLSearchParams(), signal = new AbortController().signal) {
  const fixtureId = requestedFixtureId(searchParams);
  const fixtures = await fetchTxlineFixtures();
  const candidates = fixtureRowsForOddsBootstrap(fixtures, searchParams);
  const fallbackCandidates = fixtureId && candidates.length === 0
    ? [{ FixtureId: fixtureId }]
    : candidates;

  for (const fixture of fallbackCandidates) {
    const normalizedFixture = normalizeTxlineFixtureRow(fixture);
    const oddsRows = signal.aborted || !normalizedFixture.fixtureId
      ? []
      : await fetchTxlineOdds(normalizedFixture.fixtureId);

    if (signal.aborted) break;

    if (Array.isArray(oddsRows) && oddsRows.length > 0) {
      const event = normalizeTxlineOddsMessage(
        oddsPayloadForFixture(fixture, oddsRows),
        { event: "odds_bootstrap", id: `snapshot:${normalizedFixture.fixtureId}` }
      );

      writeSse(res, "match_event", event, event.id);
      return {
        emittedFixtureId: normalizedFixture.fixtureId,
        oddsRowCount: oddsRows.length
      };
    }
  }

  return {
    emittedFixtureId: null,
    oddsRowCount: 0
  };
}

export async function handleLiveProxy(req, res, searchParams = new URLSearchParams()) {
  const requestedChannel = searchParams.get("channel") || "all";
  const channels = liveChannels(requestedChannel);
  const controller = new AbortController();
  let config = null;

  sseHeaders(res);
  req.on("close", () => controller.abort());

  try {
    config = requireTxlineCredentials();
  } catch {
    writeSse(res, "stream_notice", {
      status: "missing_credentials",
      message: "Set TXLINE_GUEST_JWT and TXLINE_API_TOKEN in .env, then restart the Sable server.",
      network: getTxlineConfig().network
    });
    res.end();
    return;
  }

  writeSse(res, "stream_notice", {
    status: "connecting",
    channel: channels.join("+"),
    network: config.network,
    apiBase: config.apiBase
  });

  try {
    const bootstrap = await emitInitialScoreSnapshots(res, searchParams, controller.signal);

    writeSse(res, "stream_notice", {
      status: bootstrap.emitted.length ? "score_bootstrap_complete" : "score_bootstrap_empty",
      channel: "scores",
      message: bootstrap.emitted.length
        ? `Loaded latest score snapshots for ${bootstrap.emitted.length} fixture(s).`
        : "TxODDS returned no score snapshots for the sampled fixtures; Sable is waiting for live score events instead of synthesizing 0-0.",
      emittedFixtureIds: bootstrap.emitted,
      missingFixtureIds: bootstrap.missing
    });
  } catch (error) {
    writeSse(res, "stream_notice", {
      status: "score_bootstrap_error",
      channel: "scores",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  try {
    const bootstrap = await emitInitialOddsSnapshot(res, searchParams, controller.signal);

    writeSse(res, "stream_notice", {
      status: bootstrap.emittedFixtureId ? "odds_bootstrap_complete" : "odds_bootstrap_empty",
      channel: "odds",
      message: bootstrap.emittedFixtureId
        ? `Loaded ${bootstrap.oddsRowCount} TxODDS odds row(s) for fixture ${bootstrap.emittedFixtureId}.`
        : "TxODDS returned no odds snapshot rows for the sampled fixtures.",
      emittedFixtureId: bootstrap.emittedFixtureId,
      oddsRowCount: bootstrap.oddsRowCount
    });
  } catch (error) {
    writeSse(res, "stream_notice", {
      status: "odds_bootstrap_error",
      channel: "odds",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  await Promise.allSettled(channels.map((channel) => pipeTxlineSseChannel({
    channel,
    res,
    fixtureId: requestedFixtureId(searchParams),
    signal: controller.signal
  })));

  if (!res.destroyed) res.end();
}

async function pipeTxlineSseChannel({
  channel = "scores",
  res,
  fixtureId = "",
  signal = new AbortController().signal
}) {
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

  await pipeSseBody({
    channel,
    res,
    fixtureId,
    signal,
    reader: upstream.body.getReader()
  });
}

async function pipeSseBody({
  channel = "scores",
  res,
  fixtureId = "",
  signal = new AbortController().signal,
  reader
}) {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      let separator = null;

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      separator = buffer.match(/\r?\n\r?\n/);

      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index);
        const message = parseSseBlock(block);

        buffer = buffer.slice(separator.index + separator[0].length);

        if (message) {
          const normalizedMessage = normalizeTxlineStreamMessage(channel, message);
          const matchesFixture = !fixtureId ||
            normalizedMessage.type === "heartbeat" ||
            normalizedMessage.fixtureId === fixtureId;

          if (matchesFixture) {
            writeSse(res, "match_event", normalizedMessage, message.id);
          }
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
