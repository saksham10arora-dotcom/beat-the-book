const { test } = require("node:test");
const assert = require("node:assert");
const E = require("../js/engine.js");

function order(id, side, px, qty) { return { id, side, px, qty }; }

test("resting order does not match when book is empty", () => {
  const b = E.createBook();
  assert.deepStrictEqual(E.submit(b, order(1, "B", 100, 50)), []);
  assert.strictEqual(b.bids[0].px, 100);
});

test("crossing order matches at the maker's price", () => {
  const b = E.createBook();
  E.submit(b, order(1, "S", 101, 50));
  const trades = E.submit(b, order(2, "B", 103, 50));
  assert.deepStrictEqual(trades, [{ takerId: 2, makerId: 1, px: 101, qty: 50 }]);
  assert.strictEqual(b.asks.length, 0);
  assert.strictEqual(b.bids.length, 0);
});

test("non-crossing order rests", () => {
  const b = E.createBook();
  E.submit(b, order(1, "S", 105, 50));
  const trades = E.submit(b, order(2, "B", 104, 50));
  assert.deepStrictEqual(trades, []);
  assert.strictEqual(b.bids[0].px, 104);
  assert.strictEqual(b.asks[0].px, 105);
});

test("price priority: better-priced level fills first", () => {
  const b = E.createBook();
  E.submit(b, order(1, "S", 102, 10));
  E.submit(b, order(2, "S", 101, 10));
  const trades = E.submit(b, order(3, "B", 102, 20));
  assert.deepStrictEqual(trades.map(t => [t.makerId, t.px]), [[2, 101], [1, 102]]);
});

test("time priority: first at a level fills first", () => {
  const b = E.createBook();
  E.submit(b, order(1, "S", 101, 10));
  E.submit(b, order(2, "S", 101, 10));
  const trades = E.submit(b, order(3, "B", 101, 10));
  assert.deepStrictEqual(trades, [{ takerId: 3, makerId: 1, px: 101, qty: 10 }]);
  assert.strictEqual(b.asks[0].orders[0].id, 2);
});

test("partial fill: remainder rests at its limit", () => {
  const b = E.createBook();
  E.submit(b, order(1, "S", 101, 30));
  const trades = E.submit(b, order(2, "B", 101, 100));
  assert.deepStrictEqual(trades, [{ takerId: 2, makerId: 1, px: 101, qty: 30 }]);
  assert.strictEqual(b.bids[0].px, 101);
  assert.strictEqual(b.bids[0].orders[0].qty, 70);
});

test("taker walks multiple levels in price order", () => {
  const b = E.createBook();
  E.submit(b, order(1, "S", 101, 10));
  E.submit(b, order(2, "S", 102, 10));
  E.submit(b, order(3, "S", 103, 10));
  const trades = E.submit(b, order(4, "B", 102, 30));
  assert.deepStrictEqual(trades.map(t => t.makerId), [1, 2]);
  assert.strictEqual(b.bids[0].orders[0].qty, 10); // leftover rests at 102
  assert.strictEqual(b.asks[0].px, 103);
});

test("nextVictim agrees with what submit actually hits", () => {
  const b = E.createBook();
  E.submit(b, order(1, "S", 101, 10));
  E.submit(b, order(2, "S", 101, 20));
  const incoming = order(3, "B", 105, 25);
  const victim = E.nextVictim(b, incoming);
  const trades = E.submit(b, { ...incoming });
  assert.strictEqual(victim.id, trades[0].makerId);
});

test("nextVictim is null when nothing crosses", () => {
  const b = E.createBook();
  E.submit(b, order(1, "S", 105, 10));
  assert.strictEqual(E.nextVictim(b, order(2, "B", 104, 10)), null);
});

test("feed is deterministic per seed", () => {
  const a = E.makeFeed(42, 500);
  const b = E.makeFeed(42, 500);
  const c = E.makeFeed(43, 500);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
});

test("replay of the game seed produces trades", () => {
  const { fills, volume } = E.replay(E.makeFeed(42, 500));
  assert.ok(fills > 100, `expected >100 fills, got ${fills}`);
  assert.ok(volume > 0);
});

test("conservation: filled + resting + taker remainder equals qty in", () => {
  const feed = E.makeFeed(7, 300);
  const book = E.createBook();
  let traded = 0;
  const qtyIn = feed.reduce((s, o) => s + o.qty, 0);
  for (const o of feed) {
    for (const t of E.submit(book, { ...o })) traded += t.qty;
  }
  let restingQty = 0;
  for (const lv of [...book.bids, ...book.asks]) {
    for (const o of lv.orders) restingQty += o.qty;
  }
  assert.strictEqual(restingQty + 2 * traded, qtyIn); // each trade consumes qty from both sides
});

test("book never crosses itself after any stream", () => {
  const book = E.createBook();
  for (const o of E.makeFeed(99, 1000)) E.submit(book, { ...o });
  if (book.bids.length && book.asks.length) {
    assert.ok(book.bids[0].px < book.asks[0].px);
  }
});

test("stepMatch repeated + rest is equivalent to submit", () => {
  const mk = () => {
    const b = E.createBook();
    E.submit(b, order(1, "S", 101, 10));
    E.submit(b, order(2, "S", 101, 20));
    E.submit(b, order(3, "S", 102, 15));
    return b;
  };
  const b1 = mk(), b2 = mk();
  const viaSubmit = E.submit(b1, order(4, "B", 102, 40));
  const o = order(4, "B", 102, 40);
  const viaStep = [];
  let t;
  while ((t = E.stepMatch(b2, o))) viaStep.push(t);
  o.seq = ++b2.seq;
  if (o.qty > 0) E.submit(b2, o); // rest remainder (won't cross by construction)
  assert.deepStrictEqual(viaStep, viaSubmit);
  assert.deepStrictEqual(b2.asks, b1.asks);
  assert.deepStrictEqual(b2.bids.map(l => [l.px, l.orders.map(x => x.qty)]),
                         b1.bids.map(l => [l.px, l.orders.map(x => x.qty)]));
});
