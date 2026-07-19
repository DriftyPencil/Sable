import { json } from "./http.js";
import { readRequestBody } from "./utils.js";
import {
  cancelOrder,
  cashOutPosition,
  getMarketOrderBook,
  getOrderBook,
  getOrCreateUser,
  getUserPortfolio,
  placeMarketOrder,
  placeOrder,
  settleMarket
} from "./market-store.js";

function routePart(pathname = "", index = 0) {
  return decodeURIComponent(pathname.split("/").filter(Boolean)[index] || "");
}

function queryUserId(searchParams = new URLSearchParams()) {
  return searchParams.get("userId") || "trader-a";
}

export async function handleExchangeUser(res, searchParams = new URLSearchParams(), pathname = "") {
  const pathUserId = routePart(pathname, 3);
  const userId = pathUserId || queryUserId(searchParams);

  json(res, 200, getUserPortfolio(userId));
}

export async function handleExchangeBook(res, pathname = "") {
  const marketId = routePart(pathname, 3);

  getOrderBook(marketId);
  json(res, 200, getMarketOrderBook(marketId));
}

export async function handleExchangeOrder(req, res) {
  const body = await readRequestBody(req);
  const orderType = String(body.orderType || "limit").toLowerCase();
  const input = {
    userId: body.userId || "trader-a",
    marketId: body.marketId,
    outcome: body.outcome,
    side: body.side,
    odds: body.odds,
    stake: body.stake
  };
  const result = orderType === "market" ? placeMarketOrder(input) : placeOrder(input);

  json(res, 200, {
    ...result,
    portfolio: getUserPortfolio(result.order.userId),
    orderBook: getMarketOrderBook(result.order.marketId)
  });
}

export async function handleExchangeCancel(req, res) {
  const body = await readRequestBody(req);
  const result = cancelOrder(body.orderId, body.userId || "trader-a");

  json(res, 200, {
    ...result,
    portfolio: getUserPortfolio(result.order.userId),
    orderBook: getMarketOrderBook(result.order.marketId)
  });
}

export async function handleExchangeCashOut(req, res) {
  const body = await readRequestBody(req);
  const result = cashOutPosition({
    userId: body.userId || "trader-a",
    marketId: body.marketId,
    outcome: body.outcome
  });

  json(res, 200, {
    ...result,
    portfolio: getUserPortfolio(result.order.userId),
    orderBook: getMarketOrderBook(result.order.marketId)
  });
}

export async function handleExchangeSettle(req, res) {
  const body = await readRequestBody(req);
  const settlement = settleMarket(
    body.marketId,
    body.winningOutcome || body.outcome,
    body.txlinePayload || {}
  );

  json(res, 200, {
    settlement,
    orderBook: getMarketOrderBook(settlement.marketId)
  });
}

export async function handleExchangeBootstrap(res) {
  const traderA = getOrCreateUser("trader-a");
  const traderB = getOrCreateUser("trader-b");

  json(res, 200, {
    users: [traderA, traderB].map((user) => ({ ...user }))
  });
}
