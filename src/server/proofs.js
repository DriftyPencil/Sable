import { json } from "./http.js";
import { fetchTxlineJson } from "./txline-client.js";

export async function handleProof(req, res, context = {}, searchParams = new URLSearchParams()) {
  const fixtureId = searchParams.get("fixtureId");
  const seq = searchParams.get("seq");
  const statKeys = searchParams.get("statKeys") || "1,2";
  const query = new URLSearchParams();

  if (!fixtureId || !seq) {
    json(res, 400, { error: "fixtureId and seq are required for TxODDS proof lookup." });
    return;
  }

  query.set("fixtureId", fixtureId);
  query.set("seq", seq);
  query.set("statKeys", statKeys);
  json(res, 200, await fetchTxlineJson("/scores/stat-validation", query));
}
