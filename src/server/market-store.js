import { randomUUID } from "node:crypto";

export const users = new Map();
export const orderBooks = new Map();
export const orders = new Map();
export const trades = new Map();
export const settlements = new Map();

const STARTING_BALANCE = 1000;
const RAKE_RATE = 0.05;
const EPSILON = 0.000001;

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(value = 0) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function normalizeId(value = "", fallback = "") {
  const text = String(value || "").trim();

  return text || fallback;
}

function normalizeSide(value = "") {
  const side = String(value || "").trim().toLowerCase();

  if (side !== "back" && side !== "lay") {
    throwPublicError(400, "invalid_order_side", "Order side must be back or lay.");
  }

  return side;
}

function throwPublicError(status = 400, error = "bad_request", message = "Invalid request.") {
  const exception = new Error(message);

  exception.status = status;
  exception.publicDetails = { error, message };
  throw exception;
}

function exposureFor(side = "back", odds = 0, stake = 0) {
  const price = Number(odds);
  const size = Number(stake);

  return roundMoney(side === "lay" ? size * Math.max(price - 1, 0) : size);
}

function assertPositiveAmount(value = 0, field = "amount") {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    throwPublicError(400, `invalid_${field}`, `${field} must be greater than 0.`);
  }

  return roundMoney(number);
}

function assertValidOdds(value = 0) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 1.01) {
    throwPublicError(400, "invalid_odds", "Decimal odds must be at least 1.01.");
  }

  return roundMoney(number);
}

function updateOrderStatus(order = {}) {
  if (order.status === "settled" || order.status === "refunded") return order.status;

  if (order.unmatched <= EPSILON) {
    order.unmatched = 0;
    order.status = "filled";
    return order.status;
  }

  order.status = order.matched > EPSILON ? "partially_matched" : "open";
  return order.status;
}

function compactBook(marketId = "") {
  const book = getOrderBook(marketId);
  const isActive = (order) => order && order.unmatched > EPSILON && ["open", "partially_matched"].includes(order.status);

  book.back = book.back.filter(isActive);
  book.lay = book.lay.filter(isActive);
}

function sortBookSide(side = "back", bookOrders = []) {
  return [...bookOrders].sort((left, right) => {
    if (side === "back") return right.odds - left.odds || left.createdAt.localeCompare(right.createdAt);
    return left.odds - right.odds || left.createdAt.localeCompare(right.createdAt);
  });
}

function openMarketOrders(marketId = "") {
  return [...orders.values()].filter((order) => (
    order.marketId === marketId &&
    ["open", "partially_matched", "filled"].includes(order.status)
  ));
}

function orderView(order = {}) {
  return {
    id: order.id,
    userId: order.userId,
    marketId: order.marketId,
    outcome: order.outcome,
    side: order.side,
    odds: order.odds,
    stake: order.stake,
    matched: order.matched,
    unmatched: order.unmatched,
    status: order.status,
    createdAt: order.createdAt
  };
}

function tradeView(trade = {}) {
  return {
    id: trade.id,
    marketId: trade.marketId,
    backOrderId: trade.backOrderId,
    layOrderId: trade.layOrderId,
    backUserId: trade.backUserId,
    layUserId: trade.layUserId,
    outcome: trade.outcome,
    odds: trade.odds,
    stake: trade.stake,
    status: trade.status,
    winnerUserId: trade.winnerUserId || null,
    payout: trade.payout || 0,
    createdAt: trade.createdAt,
    settledAt: trade.settledAt || null
  };
}

export function getOrCreateUser(userId = "demo-user") {
  const id = normalizeId(userId, "demo-user");
  const existing = users.get(id);

  if (existing) return existing;

  const user = {
    id,
    username: id
      .replaceAll("-", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    balance: STARTING_BALANCE,
    pnl: 0
  };

  users.set(id, user);
  return user;
}

export function getOrderBook(marketId = "") {
  const id = normalizeId(marketId, "market");
  const existing = orderBooks.get(id);

  if (existing) return existing;

  const book = { back: [], lay: [] };

  orderBooks.set(id, book);
  return book;
}

export function placeOrder(order = {}) {
  const userId = normalizeId(order.userId, "demo-user");
  const marketId = normalizeId(order.marketId);
  const outcome = normalizeId(order.outcome);
  const side = normalizeSide(order.side);
  const odds = assertValidOdds(order.odds);
  const stake = assertPositiveAmount(order.stake, "stake");
  const user = getOrCreateUser(userId);
  const exposure = exposureFor(side, odds, stake);
  const book = getOrderBook(marketId);
  const record = {
    id: `ord_${randomUUID()}`,
    userId,
    marketId,
    outcome,
    side,
    odds,
    stake,
    exposure,
    matched: 0,
    unmatched: stake,
    status: "open",
    createdAt: nowIso()
  };
  let newTrades = [];

  if (!marketId) {
    throwPublicError(400, "missing_market_id", "marketId is required.");
  }

  if (!outcome) {
    throwPublicError(400, "missing_outcome", "outcome is required.");
  }

  if (user.balance + EPSILON < exposure) {
    throwPublicError(400, "insufficient_balance", "User has insufficient simulated balance for this order.");
  }

  user.balance = roundMoney(user.balance - exposure);
  orders.set(record.id, record);
  book[side].push(record);
  newTrades = matchOrders(marketId);

  return {
    order: orderView(record),
    trades: newTrades.map(tradeView),
    user: { ...user }
  };
}

export function matchOrders(marketId = "") {
  const book = getOrderBook(marketId);
  const backs = sortBookSide("back", book.back);
  const lays = sortBookSide("lay", book.lay);
  const newTrades = [];

  for (const back of backs) {
    if (back.unmatched <= EPSILON) continue;

    for (const lay of lays) {
      const sameOutcome = back.outcome === lay.outcome;
      const differentUsers = back.userId !== lay.userId;
      const agreeableOdds = back.odds + EPSILON >= lay.odds;
      const canMatch = sameOutcome && differentUsers && agreeableOdds && lay.unmatched > EPSILON && back.unmatched > EPSILON;

      if (!canMatch) continue;

      const matchedStake = roundMoney(Math.min(back.unmatched, lay.unmatched));
      const trade = {
        id: `trd_${randomUUID()}`,
        marketId,
        backOrderId: back.id,
        layOrderId: lay.id,
        backUserId: back.userId,
        layUserId: lay.userId,
        outcome: back.outcome,
        odds: lay.odds,
        stake: matchedStake,
        status: "open",
        createdAt: nowIso()
      };

      back.matched = roundMoney(back.matched + matchedStake);
      back.unmatched = roundMoney(back.unmatched - matchedStake);
      lay.matched = roundMoney(lay.matched + matchedStake);
      lay.unmatched = roundMoney(lay.unmatched - matchedStake);
      updateOrderStatus(back);
      updateOrderStatus(lay);
      trades.set(trade.id, trade);
      newTrades.push(trade);
    }
  }

  compactBook(marketId);
  return newTrades;
}

export function settleMarket(marketId = "", winningOutcome = "", txlinePayload = {}) {
  const id = normalizeId(marketId);
  const outcome = normalizeId(winningOutcome);
  const existing = settlements.get(id);
  const marketTrades = [...trades.values()].filter((trade) => trade.marketId === id && trade.status !== "settled");
  const marketOrders = openMarketOrders(id);
  const payouts = [];
  let rake = 0;

  if (!id) {
    throwPublicError(400, "missing_market_id", "marketId is required.");
  }

  if (!outcome) {
    throwPublicError(400, "missing_winning_outcome", "winningOutcome is required.");
  }

  if (existing) return existing;

  for (const trade of marketTrades) {
    const backOrder = orders.get(trade.backOrderId);
    const layOrder = orders.get(trade.layOrderId);
    const backUser = getOrCreateUser(backOrder.userId);
    const layUser = getOrCreateUser(layOrder.userId);
    const backWins = trade.outcome === outcome;
    const payout = roundMoney(trade.stake * trade.odds * (1 - RAKE_RATE));
    const pool = roundMoney(trade.stake * trade.odds);
    const backExposure = exposureFor("back", trade.odds, trade.stake);
    const layExposure = exposureFor("lay", trade.odds, trade.stake);
    const winner = backWins ? backUser : layUser;
    const loser = backWins ? layUser : backUser;
    const winnerExposure = backWins ? backExposure : layExposure;
    const loserExposure = backWins ? layExposure : backExposure;

    winner.balance = roundMoney(winner.balance + payout);
    winner.pnl = roundMoney(winner.pnl + payout - winnerExposure);
    loser.pnl = roundMoney(loser.pnl - loserExposure);
    rake = roundMoney(rake + pool - payout);
    trade.status = "settled";
    trade.winningOutcome = outcome;
    trade.winnerUserId = winner.id;
    trade.payout = payout;
    trade.rake = roundMoney(pool - payout);
    trade.settledAt = nowIso();
    payouts.push({
      userId: winner.id,
      amount: payout,
      type: "winner_payout",
      tradeId: trade.id
    });
  }

  for (const order of marketOrders) {
    if (order.unmatched > EPSILON) {
      const refund = exposureFor(order.side, order.odds, order.unmatched);
      const user = getOrCreateUser(order.userId);

      user.balance = roundMoney(user.balance + refund);
      payouts.push({
        userId: user.id,
        amount: refund,
        type: "unmatched_refund",
        orderId: order.id
      });
    }

    order.unmatched = 0;
    order.status = order.matched > EPSILON ? "settled" : "refunded";
  }

  compactBook(id);

  const settlement = {
    marketId: id,
    outcome,
    txlinePayload,
    settledAt: nowIso(),
    rake,
    payouts
  };

  settlements.set(id, settlement);
  return settlement;
}

export function getUserPortfolio(userId = "demo-user") {
  const user = getOrCreateUser(userId);
  const userOrders = [...orders.values()].filter((order) => order.userId === user.id);
  const openOrders = userOrders
    .filter((order) => ["open", "partially_matched"].includes(order.status))
    .map(orderView);
  const settledTrades = [...trades.values()]
    .filter((trade) => trade.status === "settled" && (trade.backUserId === user.id || trade.layUserId === user.id))
    .map(tradeView);

  return {
    user: { ...user },
    openOrders,
    settledTrades,
    pnl: user.pnl
  };
}

export function getMarketOrderBook(marketId = "") {
  const book = getOrderBook(marketId);
  const formatSide = (side = "back") => {
    const grouped = new Map();

    for (const order of book[side].filter((item) => item.unmatched > EPSILON)) {
      const key = `${order.outcome}|${order.odds}`;
      const group = grouped.get(key) || {
        outcome: order.outcome,
        odds: order.odds,
        totalStake: 0,
        orders: []
      };

      group.totalStake = roundMoney(group.totalStake + order.unmatched);
      group.orders.push(orderView(order));
      grouped.set(key, group);
    }

    return [...grouped.values()].sort((left, right) => (
      side === "back"
        ? right.odds - left.odds || left.outcome.localeCompare(right.outcome)
        : left.odds - right.odds || left.outcome.localeCompare(right.outcome)
    ));
  };

  return {
    marketId,
    back: formatSide("back"),
    lay: formatSide("lay"),
    trades: [...trades.values()]
      .filter((trade) => trade.marketId === marketId)
      .map(tradeView),
    settlement: settlements.get(marketId) || null
  };
}
