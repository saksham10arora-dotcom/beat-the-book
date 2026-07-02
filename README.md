# beat the book

For 60 seconds, you are the matching engine of a stock exchange.

Limit orders arrive. If an order crosses the book you must execute it by hand, clicking the resting order it fills first: best price wins, and at the same price, whoever queued first. If nothing crosses, book it. When your shift ends, the real engine replays your exact order flow and reports how long your entire hour of panic would have taken it. The answer is measured in microseconds, and you get a stat card to prove it.

## The engine is real

`js/engine.js` is a genuine price-time priority matching engine: FIFO queues per price level, partial fills, multi-level walks, taker remainders resting at their limit. The game validates every click against it, and the replay at the end runs the same 500-order seeded stream through `submit()` while counting how many full replays fit in a timing window (browsers clamp `performance.now()`, so single-run timing reads zero).

14 unit tests cover price priority, time priority, partial fills, quantity conservation, book-crossing invariants, and the equivalence of click-by-click matching with atomic submission:

```
node test/engine.test.js
```

One of those tests caught a real bug during development: single-step matching looped forever on a fully filled taker. Tests are not decoration.

## The market is fair

One seed, one market. Everyone plays the same 500 orders, so scores are comparable. The book is warmed with the first 40 orders so there is depth from the first click.

## Run

Open `index.html`, or:

```
python3 -m http.server 8000
```

No framework, no build step, no backend.
