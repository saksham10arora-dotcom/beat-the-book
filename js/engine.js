// A real price-time priority matching engine.
// Limit orders only, integer price ticks, FIFO within each price level.
// Runs in the browser (game + replay) and in Node (tests).

function createBook() {
  // bids sorted best-first (descending px), asks best-first (ascending px)
  return { bids: [], asks: [], seq: 0 };
}

function levelIndex(levels, px, isBid) {
  // index of level with this px, or insertion point keeping best-first order
  for (let i = 0; i < levels.length; i++) {
    if (levels[i].px === px) return { found: true, i };
    if (isBid ? levels[i].px < px : levels[i].px > px) return { found: false, i };
  }
  return { found: false, i: levels.length };
}

function rest(book, order) {
  const isBid = order.side === "B";
  const levels = isBid ? book.bids : book.asks;
  const { found, i } = levelIndex(levels, order.px, isBid);
  if (found) levels[i].orders.push(order);
  else levels.splice(i, 0, { px: order.px, orders: [order] });
}

// Submit a limit order. Matches while it crosses, then rests any remainder.
// Returns the trades generated, in execution order.
function submit(book, order) {
  const trades = [];
  const isBid = order.side === "B";
  const opp = isBid ? book.asks : book.bids;
  order.seq = ++book.seq;

  while (order.qty > 0 && opp.length > 0) {
    const best = opp[0];
    const crosses = isBid ? best.px <= order.px : best.px >= order.px;
    if (!crosses) break;

    const maker = best.orders[0]; // price-time priority: front of best queue
    const qty = Math.min(order.qty, maker.qty);
    trades.push({ takerId: order.id, makerId: maker.id, px: best.px, qty });
    order.qty -= qty;
    maker.qty -= qty;
    if (maker.qty === 0) best.orders.shift();
    if (best.orders.length === 0) opp.shift();
  }

  if (order.qty > 0) rest(book, order);
  return trades;
}

// The one resting order an incoming order must hit first, or null if no cross.
function nextVictim(book, order) {
  if (order.qty <= 0) return null;
  const isBid = order.side === "B";
  const opp = isBid ? book.asks : book.bids;
  if (opp.length === 0) return null;
  const best = opp[0];
  const crosses = isBid ? best.px <= order.px : best.px >= order.px;
  return crosses ? best.orders[0] : null;
}

// Execute exactly one trade of an incoming order (the front-of-best-queue fill).
// Returns the trade, or null if nothing crosses. Used by the game so a human
// can walk the book one click at a time; repeated stepMatch + rest == submit.
function stepMatch(book, order) {
  const maker = nextVictim(book, order);
  if (!maker) return null;
  const isBid = order.side === "B";
  const opp = isBid ? book.asks : book.bids;
  const best = opp[0];
  const qty = Math.min(order.qty, maker.qty);
  const trade = { takerId: order.id, makerId: maker.id, px: best.px, qty };
  order.qty -= qty;
  maker.qty -= qty;
  if (maker.qty === 0) best.orders.shift();
  if (best.orders.length === 0) opp.shift();
  return trade;
}

// Deterministic order stream. mulberry32 PRNG, same seed = same market.
function makeFeed(seed, n) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const orders = [];
  let mid = 10000; // ticks of $0.01 → $100.00
  for (let i = 0; i < n; i++) {
    const side = rng() < 0.5 ? "B" : "S";
    // offset from mid: mostly passive, sometimes aggressive (crossing)
    const aggr = rng() < 0.42;
    const spread = 1 + Math.floor(rng() * 5);
    const px = side === "B"
      ? mid + (aggr ? spread : -spread)
      : mid - (aggr ? spread : -spread);
    const qty = (1 + Math.floor(rng() * 12)) * 10;
    orders.push({ id: i + 1, side, px, qty });
    if (rng() < 0.15) mid += rng() < 0.5 ? -1 : 1; // slow drift
  }
  return orders;
}

// Replay a whole stream through the engine, return stats.
function replay(orders) {
  const book = createBook();
  let fills = 0, volume = 0;
  for (const o of orders) {
    const trades = submit(book, { ...o });
    fills += trades.length;
    for (const t of trades) volume += t.qty;
  }
  return { fills, volume };
}

const Engine = { createBook, submit, nextVictim, stepMatch, makeFeed, replay };
if (typeof module !== "undefined") module.exports = Engine;
if (typeof window !== "undefined") window.Engine = Engine;
