import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(moduleDir, "../..");

export async function createServerContext() {
  await loadLocalEnv(path.join(rootDir, ".env"));

  return {
    rootDir,
    publicDir: path.join(rootDir, "public"),
    port: Number(process.env.PORT || 3000),
    mimeTypes: {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon"
    }
  };
}

export function getTxlineConfig() {
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
  const jwt = process.env.TXLINE_GUEST_JWT || "";
  const apiToken = process.env.TXLINE_API_TOKEN || "";

  return {
    network,
    apiBase: apiBase.replace(/\/$/, ""),
    guestAuth,
    programId,
    jwt,
    apiToken,
    hasCredentials: Boolean(jwt && apiToken)
  };
}

export function getTxlineHeaders({ sse = false } = {}) {
  const config = getTxlineConfig();

  return {
    Authorization: `Bearer ${config.jwt}`,
    "X-Api-Token": config.apiToken,
    Accept: sse ? "text/event-stream" : "application/json",
    "Cache-Control": "no-cache"
  };
}

export function requireTxlineCredentials() {
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
