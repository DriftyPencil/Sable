import { createHash, randomBytes } from "node:crypto";

export function delay(ms = 0, signal = new AbortController().signal) {
  return new Promise((resolve) => {
    const timerMs = Math.max(0, Number(ms) || 0);

    if (timerMs === 0 || signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, timerMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function readRequestBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

export function hashJson(value = {}) {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function fakeBase58(prefix = "") {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = randomBytes(32);
  let output = prefix;

  for (const byte of bytes) {
    output += alphabet[byte % alphabet.length];
  }

  return output.slice(0, prefix ? 44 : 64);
}

export function pickValue(object = {}, paths = []) {
  for (const pathExpression of paths) {
    const value = pathExpression.split(".").reduce((current, key) => (
      current && typeof current === "object" ? current[key] : undefined
    ), object);

    if (value !== undefined && value !== null && value !== "") return value;
  }

  return undefined;
}

export function toFiniteNumber(value, fallback = undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function pickNumber(object = {}, paths = [], fallback = 0) {
  return toFiniteNumber(pickValue(object, paths), fallback);
}

export function pickString(object = {}, paths = [], fallback = "") {
  const value = pickValue(object, paths);
  return value === undefined || value === null ? fallback : String(value);
}
