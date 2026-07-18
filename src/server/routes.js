import path from "node:path";
import { handleLiveProxy } from "./live-stream.js";
import { json, serveStatic, text } from "./http.js";
import { handleProof } from "./proofs.js";
import { handleSettlement } from "./settlement.js";
import {
  attachFixtureScoreSnapshots,
  fetchTxlineFixtures,
  fetchTxlineOddsHistory,
  fetchTxlineOdds,
  fetchTxlineScoresWithStatus,
  liveStatusPayload
} from "./txline-client.js";

function pathBasename(pathname = "") {
  return decodeURIComponent(path.basename(pathname));
}

async function handleTxlineFixtures(res, searchParams = new URLSearchParams()) {
  const query = new URLSearchParams(searchParams);
  const includeScores = query.get("includeScores") === "1";
  const scoreLimit = Number(query.get("scoreLimit") || 20);
  let fetchedFixtures = [];
  let rawFixtures = [];

  query.delete("includeScores");
  query.delete("scoreLimit");
  fetchedFixtures = await fetchTxlineFixtures(query);
  rawFixtures = Array.isArray(fetchedFixtures) ? fetchedFixtures : [];

  json(res, 200, includeScores
    ? await attachFixtureScoreSnapshots(rawFixtures, scoreLimit)
    : rawFixtures);
}

async function handleTxlineScores(res, fixtureId = "", searchParams = new URLSearchParams()) {
  const status = await fetchTxlineScoresWithStatus(fixtureId);

  if (searchParams.get("format") === "raw") {
    json(res, 200, status.records);
    return;
  }

  json(res, 200, status);
}

export function createRequestHandler(context = {}) {
  return async function handleRequest(req, res) {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/api/health") {
        json(res, 200, { ok: true, name: "Sable", ts: new Date().toISOString() });
        return;
      }

      if (req.method === "GET" && pathname === "/api/txline/status") {
        json(res, 200, liveStatusPayload());
        return;
      }

      if (req.method === "GET" && pathname === "/api/txline/fixtures") {
        await handleTxlineFixtures(res, url.searchParams);
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/api/txline/odds/")) {
        json(res, 200, await fetchTxlineOdds(pathBasename(pathname)));
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/api/txline/odds-history/")) {
        json(res, 200, await fetchTxlineOddsHistory(pathBasename(pathname), {
          hours: url.searchParams.get("hours") || 2,
          interval: url.searchParams.get("interval") || 0
        }));
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/api/txline/scores/")) {
        await handleTxlineScores(res, pathBasename(pathname), url.searchParams);
        return;
      }

      if (req.method === "GET" && pathname === "/api/stream") {
        await handleLiveProxy(req, res, url.searchParams);
        return;
      }

      if (req.method === "GET" && pathname === "/api/proofs/stat") {
        await handleProof(req, res, context, url.searchParams);
        return;
      }

      if (req.method === "POST" && pathname === "/api/settlement/simulate") {
        await handleSettlement(req, res);
        return;
      }

      if (req.method === "GET" || req.method === "HEAD") {
        await serveStatic(req, res, context, pathname);
        return;
      }

      text(res, 405, "Method not allowed");
    } catch (error) {
      json(res, error.status || 500, error.publicDetails || {
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  };
}
