// IIFE-д хийж condition.js-тэй ($, positions гэх мэт) global scope мөргүйлдэхгүй болгосон.
(function(){
"use strict";
const $ = id => document.getElementById(id);

// ==========================================================
//  GOLD TRADE — LIVE (backtest-ийн condition/data-ийг хуваалцдаг)
//  condition.js доторх: groups, val, evalGroup, initMarketData
// ==========================================================

// ==== STATE ====
let liveLoop = null;
let isRunning = false;
let lastCandleTime = null;
let positions = { LONG: [], SHORT: [] };  // local төлөв

// ==== SOURCE / SYMBOL / INTERVAL ====
function isGoldSource() {
    const m = $("market");
    return !m || m.value.toUpperCase() === "GOLD";
}
function currentSymbol() {
    const m = $("market"), c = $("coin");
    const src = m ? m.value.toUpperCase() : "GOLD";
    if (src === "FUTURES" && c && c.value.trim()) return c.value.trim().toUpperCase();
    return "GOLD";
}
function currentInterval() {
    const el = $("interval");
    return el ? (parseInt(el.value, 10) || 1) : 1;
}

// ==== LOG ====
function log(msg, type) {
    const box = $("liveLog");
    if (!box) return;
    const t = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = document.createElement("div");
    line.className = "log-line " + (type || "info");
    line.textContent = `[${t}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
}

function syncCoinVisibility() {
    const c = $("coin"), m = $("market");
    if (!c) return;
    const src = m ? m.value.toUpperCase() : "GOLD";
    c.style.display = src === "FUTURES" ? "inline-block" : "none";
}

// ==== UPDATE: strategy + data (backtest-тэй ижил) ====
async function updateData() {
    const symbol = currentSymbol();
    const im = currentInterval();
    log(`UPDATE: ${symbol} ${im}m татаж байна...`);
    try {
        const sRes = await fetch(`/api/strategy`);
        if (!sRes.ok) throw new Error(`strategy HTTP ${sRes.status}`);
        const strategy = await sRes.json();
        if (strategy && strategy.conditions) {
            Object.keys(strategy.conditions).forEach(k => {
                if (Array.isArray(strategy.conditions[k])) groups[k] = strategy.conditions[k];
            });
            log(`Strategy: ${strategy.strategy_name || "unnamed"}`);
        }
        await initMarketData();
        const n = (window.candles || []).length;
        log(`Data: ${n} candles`);
        refreshStatus();
    } catch (e) {
        log("UPDATE ERROR: " + e.message, "error");
    }
}

// ==== SIGNAL EVALUATION (backtest-тэй ижил condition) ====
function getOpenLimits(i) {
    const opens = [0, 1, 2, 3].map(n => val("candle_open_" + n, i)).filter(Number.isFinite);
    return {
        longLimit: opens.length ? Math.min(...opens) : null,
        shortLimit: opens.length ? Math.max(...opens) : null
    };
}

function evaluateSignal() {
    const candles = window.candles || [];
    if (!candles.length) return null;
    const i = candles.length - 1;
    const limits = getOpenLimits(i);
    const ctx = {
        longCount: positions.LONG.length,
        shortCount: positions.SHORT.length,
        longPnl: 0, shortPnl: 0, totalFloatingPnl: 0,
        longLimit: limits.longLimit,
        shortLimit: limits.shortLimit,
        armed: false
    };
    const hasLong = positions.LONG.length > 0;
    const hasShort = positions.SHORT.length > 0;

    // EXIT эхлээд (позиц байгаа бол хаах)
    if (hasLong && groups.longExit && groups.longExit.length && evalGroup(groups.longExit, i, ctx) === true)
        return { action: "CLOSE", side: "LONG" };
    if (hasShort && groups.shortExit && groups.shortExit.length && evalGroup(groups.shortExit, i, ctx) === true)
        return { action: "CLOSE", side: "SHORT" };
    // OPEN (позиц байхгүй бол нээх)
    if (!hasLong && groups.longOpen && groups.longOpen.length && evalGroup(groups.longOpen, i, ctx) === true)
        return { action: "OPEN", side: "LONG" };
    if (!hasShort && groups.shortOpen && groups.shortOpen.length && evalGroup(groups.shortOpen, i, ctx) === true)
        return { action: "OPEN", side: "SHORT" };
    return null;
}

// ==== EXECUTE ORDER ====
async function executeOrder(signal) {
    const symbol = currentSymbol();
    const im = currentInterval();
    // GOLD → MT5 bridge (серверээр дамжин mt5_bridge.py гүйцэтгэнэ); FUTURES → Binance (client.py).
    const useMT5 = isGoldSource();
    const endpoint = useMT5 ? `/api/mt5/signal` : `/api/live/order`;
    log(`SIGNAL: ${signal.action} ${signal.side} → ${useMT5 ? "MT5" : "Binance"} рүү илгээж байна...`);
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol, side: signal.side, action: signal.action, interval: im })
        });
        const r = await res.json();
        if (r.status === "success") {
            if (useMT5) {
                log(`✅ MT5 SIGNAL QUEUED: ${signal.action} ${signal.side} (mt5_bridge гүйцэтгэнэ)`, "success");
            } else {
                log(`✅ ORDER OK: ${signal.action} ${signal.side}`, "success");
            }
            if (signal.action === "OPEN") positions[signal.side].push({ entryTime: Date.now() });
            else positions[signal.side] = [];
            refreshStatus();
        } else {
            log(`❌ ORDER FAIL: ${r.message || "unknown"}`, "error");
        }
    } catch (e) {
        log("ORDER ERROR: " + e.message, "error");
    }
}

// ==== LIVE TICK ====
async function liveTick() {
    try {
        // data шинэчлэх (backtest-тэй ижил бүтэц: per-candle RSI/MACD/OHLC)
        await initMarketData();
        const candles = window.candles || [];
        if (!candles.length) return;
        const lastTime = candles[candles.length - 1].open_time;
        if (lastTime !== lastCandleTime) {
            lastCandleTime = lastTime;
            const signal = evaluateSignal();
            if (signal) await executeOrder(signal);
        }
    } catch (e) {
        log("TICK ERROR: " + e.message, "error");
    }
}

// ==== START / STOP ====
async function startTrading() {
    if (isRunning) { log("Already running"); return; }
    await updateData();
    const symbol = currentSymbol();
    try {
        const res = await fetch(`/api/live/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol })
        });
        const r = await res.json();
        if (r.status !== "success" && r.status !== "already_running") {
            log("START FAIL: " + (r.message || "unknown"), "error");
            return;
        }
        isRunning = true;
        lastCandleTime = null;
        log("▶ LIVE TRADING STARTED", "success");
        liveLoop = setInterval(liveTick, 5000);  // 5 сек тутамд шинэ candle шалгах
        refreshStatus();
    } catch (e) {
        log("START ERROR: " + e.message, "error");
    }
}

function stopTrading() {
    if (!isRunning) { log("Not running"); return; }
    if (liveLoop) clearInterval(liveLoop);
    liveLoop = null;
    isRunning = false;
    fetch(`/api/live/stop`, { method: "POST" });
    log("⏹ LIVE TRADING STOPPED", "warn");
    refreshStatus();
}

// ==== STATUS ====
async function refreshStatus() {
    try {
        const res = await fetch(`/api/live/status`);
        const s = await res.json();
        const stats = $("liveStats");
        if (stats) {
            stats.innerHTML = `
                <div class="card"><div class="label">STATE</div><div class="value" style="color:${s.running ? "#0ecb81" : "#f6465d"}">${s.running ? "RUNNING" : "STOPPED"}</div></div>
                <div class="card"><div class="label">SYMBOL</div><div class="value">${s.symbol || "-"}</div></div>
                <div class="card"><div class="label">CANDLES</div><div class="value">${(window.candles || []).length}</div></div>
                <div class="card"><div class="label">LONG POS</div><div class="value" style="color:#0ecb81">${positions.LONG.length}</div></div>
                <div class="card"><div class="label">SHORT POS</div><div class="value" style="color:#f6465d">${positions.SHORT.length}</div></div>
            `;
        }
        const note = $("liveNote");
        if (note) {
            note.textContent = s.running
                ? `✅ ${s.symbol} дээр live арилжаа ажиллаж байна. STOP дарж зогсооно.`
                : `Зогсоосон. UPDATE → START дарж эхлүүлнэ.`;
        }
    } catch (e) {}
}

// ==== INIT ====
window.addEventListener("DOMContentLoaded", async () => {
    $("updateBtn")?.addEventListener("click", updateData);
    $("startBtn")?.addEventListener("click", startTrading);
    $("stopBtn")?.addEventListener("click", stopTrading);
    $("market")?.addEventListener("change", () => { syncCoinVisibility(); });
    syncCoinVisibility();
    log("Gold Trade Live. UPDATE дараад стратеги/дата татаж аваарай.");
    await updateData();
});
})();