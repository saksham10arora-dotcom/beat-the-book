(() => {
  "use strict";
  const E = window.Engine;

  const SEED = 42, FEED_N = 500, WARMUP = 40, ROUND_MS = 60000;
  const $ = id => document.getElementById(id);
  const screens = { title: $("screen-title"), game: $("screen-game"), results: $("screen-results") };

  const px$ = px => "$" + (px / 100).toFixed(2);

  let book, feed, cursor, incoming, timerEnd, timerId;
  let fills = 0, errors = 0, volume = 0, playerStartedAt = 0;

  function show(name) {
    for (const k in screens) screens[k].hidden = k !== name;
  }

  // ---------- round setup ----------

  function startRound() {
    book = E.createBook();
    feed = E.makeFeed(SEED, FEED_N);
    // warm the book so there is depth from the first click
    cursor = 0;
    while (cursor < WARMUP) E.submit(book, { ...feed[cursor++] });
    fills = 0; errors = 0; volume = 0;
    incoming = null;
    playerStartedAt = performance.now();
    timerEnd = playerStartedAt + ROUND_MS;
    show("game");
    nextOrder();
    tick();
    timerId = setInterval(tick, 100);
  }

  function tick() {
    const left = Math.max(0, timerEnd - performance.now());
    $("s-time").textContent = (left / 1000).toFixed(1);
    if (left <= 0) endRound();
  }

  function nextOrder() {
    if (cursor >= feed.length) return endRound();
    incoming = { ...feed[cursor++] };
    renderIncoming();
    renderBook();
  }

  // ---------- rendering ----------

  function renderIncoming() {
    const buy = incoming.side === "B";
    $("inc-body").innerHTML =
      `<span class="${buy ? "b" : "s"}">${buy ? "BUY" : "SELL"}</span> ${incoming.qty} @ ${px$(incoming.px)}`;
    // never hint whether it crosses; that decision is the game
    $("inc-ask").textContent = incoming.qty < feed[cursor - 1].qty
      ? "still " + incoming.qty + " to place. where does it go?"
      : "where does it go?";
  }

  function renderBook() {
    renderSide($("levels-bids"), book.bids, "b");
    renderSide($("levels-asks"), book.asks, "s");
  }

  function renderSide(host, levels, cls) {
    host.innerHTML = "";
    for (const lv of levels.slice(0, 7)) {
      const row = document.createElement("div");
      row.className = "level";
      const price = document.createElement("div");
      price.className = "px " + cls;
      price.textContent = px$(lv.px);
      row.appendChild(price);
      const q = document.createElement("div");
      q.className = "queue";
      for (const o of lv.orders.slice(0, 8)) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip " + cls;
        chip.textContent = o.qty;
        chip.dataset.oid = o.id;
        chip.addEventListener("click", () => clickChip(o));
        q.appendChild(chip);
      }
      if (lv.orders.length > 8) {
        const more = document.createElement("span");
        more.className = "more";
        more.textContent = "+" + (lv.orders.length - 8);
        q.appendChild(more);
      }
      row.appendChild(q);
      host.appendChild(row);
    }
  }

  function flash(msg, ok) {
    const f = $("feedback");
    f.textContent = msg;
    f.className = ok ? "ok" : "bad";
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { f.textContent = ""; f.className = ""; }, 1200);
  }

  // ---------- player actions ----------

  function clickChip(order) {
    if (!incoming) return;
    const victim = E.nextVictim(book, incoming);
    if (victim && victim.id === order.id) {
      const t = E.stepMatch(book, incoming);
      fills++; volume += t.qty;
      $("s-fills").textContent = fills;
      flash(`filled ${t.qty} @ ${px$(t.px)}`, true);
      if (E.nextVictim(book, incoming)) {
        renderIncoming(); renderBook(); // keep walking the book
      } else {
        if (incoming.qty > 0) {
          E.submit(book, incoming); // remainder rests
          flash(`filled ${t.qty} @ ${px$(t.px)} · remainder booked`, true);
        }
        nextOrder();
      }
    } else {
      errors++;
      $("s-errors").textContent = errors;
      flash(victim ? "wrong order. price first, then time." : "it doesn't cross. book it.", false);
    }
  }

  $("btn-rest").addEventListener("click", () => {
    if (!incoming) return;
    if (E.nextVictim(book, incoming)) {
      errors++;
      $("s-errors").textContent = errors;
      flash("it crosses. someone was waiting for this trade.", false);
    } else {
      E.submit(book, incoming);
      flash("booked.", true);
      nextOrder();
    }
  });

  // ---------- results ----------

  function timeEngine(orders) {
    // browsers clamp performance.now() resolution, so timing one replay reads 0.
    // Instead: count how many full replays fit in a ~20ms window, three times,
    // and report the best window's per-replay average in µs.
    for (let i = 0; i < 20; i++) E.replay(orders); // warm JIT
    let best = Infinity;
    for (let w = 0; w < 3; w++) {
      let n = 0;
      const t0 = performance.now();
      let t1 = t0;
      while ((t1 = performance.now()) - t0 < 20) { E.replay(orders); n++; }
      best = Math.min(best, ((t1 - t0) * 1000) / n);
    }
    return best; // µs per full 500-order replay
  }

  function endRound() {
    clearInterval(timerId);
    incoming = null;
    const playedMs = Math.min(ROUND_MS, performance.now() - playerStartedAt);

    const stats = E.replay(feed);
    const engineUs = timeEngine(feed);

    const perFillUs = engineUs / stats.fills;
    const yourWorkloadUs = perFillUs * Math.max(1, fills);
    const ratio = (playedMs * 1000) / yourWorkloadUs;

    $("r-you-fills").textContent = `${fills} fills`;
    $("r-you-detail").textContent =
      `${errors} error${errors === 1 ? "" : "s"} in ${(playedMs / 1000).toFixed(0)} seconds`;
    $("r-eng-fills").textContent = `${stats.fills} fills`;
    $("r-eng-detail").textContent =
      `the whole session, all ${FEED_N} orders, in ${engineUs < 1000 ? engineUs.toFixed(0) + " µs" : (engineUs / 1000).toFixed(2) + " ms"}`;

    const engBarPx = Math.max(1, (engineUs / (playedMs * 1000)) * 600);
    $("eng-bar").style.width = engBarPx.toFixed(2) + "px";
    $("tl-note").textContent = engBarPx <= 1.5 ? "(that sliver is generous. it rounds up.)" : "";

    $("verdict").innerHTML =
      `your share of the work would have taken the engine ` +
      `<strong>${yourWorkloadUs < 1000 ? yourWorkloadUs.toFixed(1) + " µs" : (yourWorkloadUs / 1000).toFixed(2) + " ms"}</strong>. ` +
      `you are <strong>${Math.round(ratio).toLocaleString()}×</strong> too slow to trade. ` +
      `someone has to build the engine instead.`;

    window.__lastResult = { fills, errors, playedMs, engineUs, engineFills: stats.fills, ratio };
    drawCard(window.__lastResult);
    show("results");
  }

  // ---------- stat card ----------

  function drawCard(r) {
    const c = $("card"), x = c.getContext("2d");
    x.fillStyle = "#0c120e"; x.fillRect(0, 0, 1200, 630);
    x.strokeStyle = "#1f2b24"; x.lineWidth = 2; x.strokeRect(24, 24, 1152, 582);
    x.fillStyle = "#ffe14d";
    x.font = "72px 'Archivo Black', sans-serif";
    x.fillText("BEAT THE BOOK", 64, 130);
    x.fillStyle = "#d8e6dc";
    x.font = "34px 'Fragment Mono', monospace";
    x.fillText(`me:  ${r.fills} fills, ${r.errors} errors, 60 seconds`, 64, 230);
    x.fillText(`engine:  ${r.engineFills} fills in ${r.engineUs < 1000 ? r.engineUs.toFixed(0) + " microseconds" : (r.engineUs / 1000).toFixed(1) + " ms"}`, 64, 290);
    x.fillStyle = "#ff6b57";
    x.font = "96px 'Archivo Black', sans-serif";
    x.fillText(`${Math.round(r.ratio).toLocaleString()}x TOO SLOW`, 64, 430);
    x.fillStyle = "#5f6f66";
    x.font = "28px 'Fragment Mono', monospace";
    x.fillText("be the matching engine for 60 seconds:", 64, 520);
    x.fillStyle = "#3ddc84";
    x.fillText("book.saksham.digital", 64, 560);
  }

  $("btn-card").addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = "beat-the-book.png";
    a.href = $("card").toDataURL("image/png");
    a.click();
  });

  $("btn-copy").addEventListener("click", async () => {
    const r = window.__lastResult;
    const txt = `I was a stock exchange matching engine for 60 seconds: ${r.fills} fills, ${r.errors} errors. ` +
      `The real engine did my whole shift in ${r.engineUs < 1000 ? Math.round(r.engineUs) + " microseconds" : (r.engineUs / 1000).toFixed(1) + " ms"}. ` +
      `I am ${Math.round(r.ratio).toLocaleString()}x too slow to trade. Try your shift: book.saksham.digital`;
    try { await navigator.clipboard.writeText(txt); flashBtn($("btn-copy"), "copied"); }
    catch { prompt("copy this:", txt); }
  });

  function flashBtn(btn, msg) {
    const old = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  $("btn-again").addEventListener("click", startRound);
  $("btn-start").addEventListener("click", startRound);

  // debug / verification hook
  window.__btb = {
    get state() { return { fills, errors, cursor, incoming, playing: !screens.game.hidden }; },
    victim: () => E.nextVictim(book, incoming),
    click: o => clickChip(o),
    end: () => endRound(),
    start: startRound,
    book: () => book
  };
})();
