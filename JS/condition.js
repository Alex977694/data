"use strict";

const $ = id => document.getElementById(id);
// null/undefined/"" -> null (Number(null) === 0 болохоос сэргийлнэ)
const toNum = v => (v === null || v === undefined || v === "") ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

// ==================== 1. RAILWAY DATAS & CANDLES ====================
window.candles = window.candles || [];

// JSON-ийг "эцэг.хүүхэд" түлхүүртэй хавтгай объект болгоно (жишээ: cross_history.s30u)
function flatten(obj, prefix = "", out = {}) {
    Object.entries(obj || {}).forEach(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
        else out[key] = v;
    });
    return out;
}

// Backend-ээс шинэ түлхүүр нэмэгдвэл dropdown-д автоматаар орно (нэр нь JSON-ийнхтой ижил)
function registerKeys(flat, source) {
    Object.entries(flat).forEach(([k, v]) => {
        if (k === "symbol" || Array.isArray(v) || def(k)) return;
        const kind = typeof v === "boolean" ? "bool"
            : /_time$/.test(k) ? "time"
            : (v === null || typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))) ? "number"
            : "text";
        values.push({ name: k, source, kind });
    });
}

function refreshGroups() {
    Object.keys(groups).forEach(t => renderGroup(t));
}

async function initMarketData() {
    const status = $("status") || document.getElementById("status");
    if(status) status.textContent = "Loading GOLD data & All Indicators from Railway...";

    try {
        const BASE = window.location.origin;
        const res = await fetch(`${BASE}/api/gold`);
        const data = await res.json();

        if (!data.candles || !Array.isArray(data.candles)) {
            throw new Error("No candles found in response");
        }

        const [rsiRes, macdRes, ohlcRes] = await Promise.all([
            fetch(`${BASE}/rsi/GOLD`).then(r => r.json()).catch(() => ({})),
            fetch(`${BASE}/macd/GOLD`).then(r => r.json()).catch(() => ({})),
            fetch(`${BASE}/ohlc/GOLD`).then(r => r.json()).catch(() => ({}))
        ]);

        console.log("RSI Data:", rsiRes);
        console.log("MACD Data:", macdRes);
        console.log("OHLC Data:", ohlcRes);

        const ohlcFlat = flatten(ohlcRes), rsiFlat = flatten(rsiRes), macdFlat = flatten(macdRes);
        registerKeys(ohlcFlat, "OHLC");
        registerKeys(rsiFlat, "RSI");
        registerKeys(macdFlat, "MACD");

        const snapshot = { ...ohlcFlat, ...rsiFlat, ...macdFlat };
        delete snapshot.symbol;
        delete snapshot.rsi_array;
        delete snapshot.macd_line_array;
        delete snapshot.macd_signal_array;
        delete snapshot.macd_histogram_array;
        const lastIdx = data.candles.length - 1;
        const rsiValues = Array.isArray(rsiRes.rsi_array) ? rsiRes.rsi_array : [];
        const rsiOffset = data.candles.length - rsiValues.length;
        const macdSeries = {
            line: Array.isArray(macdRes.macd_line_array) ? macdRes.macd_line_array : [],
            signal: Array.isArray(macdRes.macd_signal_array) ? macdRes.macd_signal_array : [],
            histogram: Array.isArray(macdRes.macd_histogram_array) ? macdRes.macd_histogram_array : []
        };
        const macdOffsets = Object.fromEntries(
            Object.entries(macdSeries).map(([key, series]) => [key, data.candles.length - series.length])
        );
        const seriesValue = (series, index, offset) => {
            const value = series[index - offset];
            return value === undefined ? null : toNum(value);
        };
        const indicatorTime = candle => {
            let timestamp = Number(candle?.open_time);
            if (!Number.isFinite(timestamp)) return null;
            if (timestamp < 1e11) timestamp *= 1000;
            return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
        };
        let lastRsiStatus = "None";
        let lastRsiStatusTime = null;
        let lastMacdTrend = "None";
        const rsiCrossHistory = { s30u: [], s30d: [], s70u: [], s70d: [] };
        const rsiTrendHistory = [];
        let previousOpenup = false;
        let previousOpendown = false;
        let openupLimit = null;
        let opendownLimit = null;
        let macdUpStart = null;
        let macdDownStart = null;
        let macdPeakValue = 0;
        let macdPeakPrice = 0;
        let macdPeakTime = null;
        let macdTroughValue = 0;
        let macdTroughPrice = 0;
        let macdTroughTime = null;
        let lastPeak = null;
        let lastTrough = null;
        let macdUplimit = null;
        let macdDownlimit = null;
        let uplimitCrossLine = null;
        let downlimitCrossLine = null;
        let completedMacdPeak = { macd_value: 0, price: 0 };
        let completedMacdTrough = { macd_value: 0, price: 0 };
        const macdInitial = {
            macd_initial_up: null,
            macd_initial_down: null,
            signal_initial_up: null,
            signal_initial_down: null
        };

        window.candles = data.candles.map((c, index) => {
            const rsiAt = n => seriesValue(rsiValues, n, rsiOffset);
            const macdAt = (key, n) => seriesValue(macdSeries[key], n, macdOffsets[key]);
            const currentRsi = rsiAt(index);
            const previousRsi = rsiAt(index - 1);
            const rsiCross = {
                "30_up": previousRsi !== null && currentRsi !== null && previousRsi <= 30 && currentRsi > 30,
                "70_up": previousRsi !== null && currentRsi !== null && previousRsi <= 70 && currentRsi > 70,
                "30_down": previousRsi !== null && currentRsi !== null && previousRsi >= 30 && currentRsi < 30,
                "70_down": previousRsi !== null && currentRsi !== null && previousRsi >= 70 && currentRsi < 70
            };
            const rsiStatus = rsiCross["30_up"] ? "30U"
                : rsiCross["30_down"] ? "30D"
                : rsiCross["70_up"] ? "70U"
                : rsiCross["70_down"] ? "70D" : null;
            if (rsiStatus) {
                lastRsiStatus = rsiStatus;
                lastRsiStatusTime = indicatorTime(c);
            }

            const rsiTrendStatus = previousRsi === null || currentRsi === null ? null
                : previousRsi <= 30 && currentRsi > 30 ? "30U"
                : previousRsi >= 30 && currentRsi < 30 ? "30D"
                : previousRsi <= 50 && currentRsi > 50 ? "50U"
                : previousRsi >= 50 && currentRsi < 50 ? "50D"
                : previousRsi <= 70 && currentRsi > 70 ? "70U"
                : previousRsi >= 70 && currentRsi < 70 ? "70D" : null;
            if (rsiTrendStatus && rsiTrendHistory[0] !== rsiTrendStatus) {
                rsiTrendHistory.unshift(rsiTrendStatus);
                if (rsiTrendHistory.length > 10) rsiTrendHistory.pop();
            }
            let historicalRsiTrend = "None";
            for (let trendIndex = rsiTrendHistory.length - 1; trendIndex > 0; trendIndex--) {
                const current = rsiTrendHistory[trendIndex];
                const previous = rsiTrendHistory[trendIndex - 1];
                if ((previous === "30U" && current === "50U") || (previous === "50U" && current === "70U")) {
                    historicalRsiTrend = previous === "30U" ? "uptrand1" : "uptrand2";
                    break;
                }
                if ((previous === "70D" && current === "50D") || (previous === "50D" && current === "30D")) {
                    historicalRsiTrend = previous === "70D" ? "downtrand1" : "downtrand2";
                    break;
                }
            }

            const currentLine = macdAt("line", index);
            const previousLine = macdAt("line", index - 1);
            const currentSignal = macdAt("signal", index);
            const previousSignal = macdAt("signal", index - 1);
            const closedIndex = index - 1;
            const closedLine = macdAt("line", closedIndex);
            const priorClosedLine = macdAt("line", closedIndex - 1);
            const closedSignal = macdAt("signal", closedIndex);
            const priorClosedSignal = macdAt("signal", closedIndex - 1);
            if (closedIndex > 0 && closedLine !== null && priorClosedLine !== null) {
                const closedCandle = data.candles[closedIndex];
                if (priorClosedLine <= 0 && closedLine > 0) {
                    if (macdDownStart !== null) {
                        completedMacdTrough = {
                            macd_value: macdTroughValue,
                            price: macdTroughPrice
                        };
                    }
                    lastTrough = null;
                    macdUpStart = closedIndex;
                    macdPeakValue = closedLine;
                    macdPeakPrice = Number(closedCandle.open);
                    macdPeakTime = indicatorTime(closedCandle);
                    macdInitial.macd_initial_up = { price: macdPeakPrice, time: indicatorTime(closedCandle) };
                } else if (macdUpStart !== null && closedLine > macdPeakValue) {
                    macdPeakValue = closedLine;
                    macdPeakPrice = Number(closedCandle.open);
                    macdPeakTime = indicatorTime(closedCandle);
                }
                if (priorClosedLine >= 0 && closedLine < 0) {
                    if (macdUpStart !== null) {
                        completedMacdPeak = {
                            macd_value: macdPeakValue,
                            price: macdPeakPrice
                        };
                    }
                    lastPeak = null;
                    macdDownStart = closedIndex;
                    macdTroughValue = closedLine;
                    macdTroughPrice = Number(closedCandle.open);
                    macdTroughTime = indicatorTime(closedCandle);
                    macdInitial.macd_initial_down = { price: macdTroughPrice, time: indicatorTime(closedCandle) };
                } else if (macdDownStart !== null && closedLine < macdTroughValue) {
                    macdTroughValue = closedLine;
                    macdTroughPrice = Number(closedCandle.open);
                    macdTroughTime = indicatorTime(closedCandle);
                }
            }
            lastPeak = closedLine > 0 && macdUpStart !== null
                ? { macd_value: macdPeakValue, price: macdPeakPrice, time: macdPeakTime }
                : null;
            lastTrough = closedLine < 0 && macdDownStart !== null
                ? { macd_value: macdTroughValue, price: macdTroughPrice, time: macdTroughTime }
                : null;
            if (closedIndex > 0 && closedLine !== null && priorClosedLine !== null
                && closedSignal !== null && priorClosedSignal !== null) {
                const closedCandle = data.candles[closedIndex];
                if (priorClosedSignal < 0 && closedSignal > 0) {
                    macdInitial.signal_initial_up = { price: Number(closedCandle.open), time: indicatorTime(closedCandle) };
                }
                if (priorClosedSignal > 0 && closedSignal < 0) {
                    macdInitial.signal_initial_down = { price: Number(closedCandle.open), time: indicatorTime(closedCandle) };
                }
                if (closedIndex >= 3) {
                    const crossWindow = [closedIndex - 3, closedIndex - 2, closedIndex - 1, closedIndex]
                        .map(at => macdAt("line", at));
                    if (priorClosedLine < priorClosedSignal && closedLine > closedSignal) {
                        macdUplimit = Math.min(...crossWindow);
                        uplimitCrossLine = closedLine;
                    }
                    if (priorClosedLine > priorClosedSignal && closedLine < closedSignal) {
                        macdDownlimit = Math.max(...crossWindow);
                        downlimitCrossLine = closedLine;
                    }
                }
            }
            const macdUpcross = previousLine !== null && previousSignal !== null
                && currentLine !== null && currentSignal !== null
                && previousLine <= previousSignal && currentLine > currentSignal;
            const macdDowncross = previousLine !== null && previousSignal !== null
                && currentLine !== null && currentSignal !== null
                && previousLine >= previousSignal && currentLine < currentSignal;
            if (macdUpcross) lastMacdTrend = "UP";
            else if (macdDowncross) lastMacdTrend = "DOWN";

            const indicatorFields = {};
            const ohlcWindow = data.candles.slice(Math.max(0, index - 3), index + 1);
            if (ohlcWindow.length === 4) {
                const opens = ohlcWindow.map(item => Number(item.open));
                const closes = ohlcWindow.map(item => Number(item.close));
                const highs = ohlcWindow.map(item => Number(item.high));
                const lows = ohlcWindow.map(item => Number(item.low));
                indicatorFields.min_open = Math.min(...opens);
                indicatorFields.max_open = Math.max(...opens);
                indicatorFields.min_close = Math.min(...closes);
                indicatorFields.max_close = Math.max(...closes);
                indicatorFields.max_high = Math.max(...highs);
                indicatorFields.min_low = Math.min(...lows);
            }
            if (index > 0) {
                const open = Number(c.open);
                const previousOpen = Number(data.candles[index - 1].open);
                const openup = open > previousOpen;
                const opendown = open < previousOpen;
                if (openup && !previousOpenup && ohlcWindow.length === 4) {
                    openupLimit = Math.min(...ohlcWindow.map(item => Number(item.open)));
                }
                if (opendown && !previousOpendown && ohlcWindow.length === 4) {
                    opendownLimit = Math.max(...ohlcWindow.map(item => Number(item.open)));
                }
                previousOpenup = openup;
                previousOpendown = opendown;
                indicatorFields.openup = openup;
                indicatorFields.opendown = opendown;
                if (openupLimit !== null) indicatorFields.openup_limit = openupLimit;
                if (opendownLimit !== null) indicatorFields.opendown_limit = opendownLimit;
            }

            [0, 1, 2, 3].forEach(offset => {
                const value = rsiAt(index - offset);
                if (value !== null) indicatorFields[`rsi${offset}`] = value;
            });
            if (currentRsi !== null) indicatorFields.rsi = currentRsi;

            [["30_up", "UP"], ["70_up", "UP"], ["30_down", "DOWN"], ["70_down", "DOWN"]]
                .forEach(([key, activeValue]) => {
                    if (previousRsi !== null && currentRsi !== null) {
                        indicatorFields[key] = rsiCross[key] ? activeValue : "--";
                    }
                });
            if (previousRsi !== null && currentRsi !== null) indicatorFields.last_status = lastRsiStatus;
            if (lastRsiStatusTime !== null) indicatorFields.last_status_time = lastRsiStatusTime;
            if (previousRsi !== null && currentRsi !== null) indicatorFields.trend = historicalRsiTrend;

            if (ohlcWindow.length === 4) {
                const eventKeys = { "30_up": "s30u", "30_down": "s30d", "70_up": "s70u", "70_down": "s70d" };
                const opens = ohlcWindow.map(item => Number(item.open));
                Object.entries(eventKeys).forEach(([eventName, historyKey]) => {
                    if (!rsiCross[eventName]) return;
                    const price = eventName.endsWith("_up") ? Math.min(...opens) : Math.max(...opens);
                    rsiCrossHistory[historyKey].unshift({ price, time: indicatorTime(c) });
                    if (rsiCrossHistory[historyKey].length > 2) rsiCrossHistory[historyKey].pop();
                });
            }
            Object.entries(rsiCrossHistory).forEach(([historyKey, history]) => {
                if (!history.length) return;
                indicatorFields[`cross_history.${historyKey}`] = history[0].price;
                indicatorFields[`cross_history.${historyKey}_time`] = history[0].time;
                if (history[1]) {
                    indicatorFields[`cross_history.${historyKey}_prev`] = history[1].price;
                    indicatorFields[`cross_history.${historyKey}_prev_time`] = history[1].time;
                }
            });
            const latest30up = rsiCrossHistory.s30u[0]?.price;
            const latest70down = rsiCrossHistory.s70d[0]?.price;
            if (latest30up && latest70down) indicatorFields.average_status = (latest30up + latest70down) / 2;

            const macdNames = { line: "macd_line", signal: "macd_signal", histogram: "macd_histogram" };
            Object.entries(macdNames).forEach(([key, name]) => {
                for (let offset = 0; offset < 5; offset++) {
                    const value = macdAt(key, index - offset);
                    if (value !== null) {
                        const prefix = offset === 0 ? "latest" : ["previous", "previous_2", "previous_3", "previous_4"][offset - 1];
                        indicatorFields[`${prefix}_${name}`] = value;
                    }
                }
            });
            if (currentLine !== null && currentSignal !== null) {
                indicatorFields.macd_up = currentLine > currentSignal;
                indicatorFields.macd_down = currentLine < currentSignal;
                indicatorFields.macd_line_up = currentLine > 0;
                indicatorFields.macd_line_down = currentLine < 0;
                indicatorFields.macd_trend = lastMacdTrend;
            }
            if (previousLine !== null && previousSignal !== null && currentLine !== null && currentSignal !== null) {
                indicatorFields.macd_upcross = macdUpcross;
                indicatorFields.macd_downcross = macdDowncross;
            }
            if (currentLine !== null) {
                indicatorFields["macd_peak.macd_value"] = completedMacdPeak.macd_value;
                indicatorFields["macd_peak.price"] = completedMacdPeak.price;
                indicatorFields["macd_trough.macd_value"] = completedMacdTrough.macd_value;
                indicatorFields["macd_trough.price"] = completedMacdTrough.price;
            }
            indicatorFields["last_peak.macd_value"] = lastPeak?.macd_value ?? null;
            indicatorFields["last_peak.price"] = lastPeak?.price ?? null;
            indicatorFields["last_peak.time"] = lastPeak?.time ?? null;
            indicatorFields["last_trough.macd_value"] = lastTrough?.macd_value ?? null;
            indicatorFields["last_trough.price"] = lastTrough?.price ?? null;
            indicatorFields["last_trough.time"] = lastTrough?.time ?? null;
            indicatorFields.macd_average = (completedMacdPeak.macd_value + completedMacdTrough.macd_value) / 2;
            if (index >= 3) {
                const previousMacdValues = [];
                for (let at = Math.max(0, index - 4); at < index; at++) {
                    previousMacdValues.push(macdAt("line", at));
                }
                if (previousMacdValues.length && previousMacdValues.every(value => value !== null)) {
                    indicatorFields.macd_min = Math.min(...previousMacdValues);
                    indicatorFields.macd_max = Math.max(...previousMacdValues);
                }
            }
            if (macdUplimit !== null) indicatorFields.macd_uplimit = macdUplimit;
            if (macdDownlimit !== null) indicatorFields.macd_downlimit = macdDownlimit;
            if (uplimitCrossLine !== null) indicatorFields.uplimit_cross_line = uplimitCrossLine;
            if (downlimitCrossLine !== null) indicatorFields.downlimit_cross_line = downlimitCrossLine;
            Object.entries(macdInitial).forEach(([key, value]) => {
                if (!value) return;
                indicatorFields[`${key}_price`] = value.price;
                indicatorFields[`${key}_time`] = value.time;
            });

            return {
                ...c,
                ...(index === lastIdx ? snapshot : {}),
                ...indicatorFields,
                bid: toNum(c.bid) ?? Number(c.close),
                ask: toNum(c.ask) ?? Number(c.close)
            };
        });

        console.log("✅ Candles + JSON fields loaded:", window.candles.length);
        if(status) status.textContent = `✅ GOLD data & Indicators loaded — ${window.candles.length} candles`;

        refreshGroups();
        if (typeof applyIndicators === "function") await applyIndicators();

    } catch (e) {
        console.error("❌ Failed to load candles or indicators:", e);
        if(status) status.textContent = "❌ Failed to load data: " + e.message;
    }
}

const positionMode = { LONG: "SINGLE", SHORT: "SINGLE" };
const maxPositions = { LONG: 1, SHORT: 1 };
const limitTrailEnabled = { LONG: false, SHORT: false };
const limitTrailReset = { LONG: false, SHORT: false };

const indicatorSettings = {
    rsiPeriod: 7, rsiSource: "close",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
};

const groups = {
 longOpen:[], longReset:[], longExit:[], longReadyClose:[],
 shortOpen:[], shortReset:[], shortExit:[], shortReadyClose:[],
 longLimitTrailArm:[], longLimitTrail:[],
 shortLimitTrailArm:[], shortLimitTrail:[]
};

const CFG = {
 longOpen:["LONG OPEN CONDITION","LONG OPEN","+ ADD CONDITION"],
 longReset:["LONG RESET CONDITION","LONG RESET","+ ADD RESET CONDITION"],
 longExit:["LONG EXIT CONDITION","LONG EXIT","+ ADD EXIT CONDITION"],
 shortOpen:["SHORT OPEN CONDITION","SHORT OPEN","+ ADD CONDITION"],
 shortReset:["SHORT RESET CONDITION","SHORT RESET","+ ADD RESET CONDITION"],
 shortExit:["SHORT EXIT CONDITION","SHORT EXIT","+ ADD EXIT CONDITION"],
 longLimitTrailArm:["LONG LIMIT TRAIL ARM CONDITION","LONG LIMIT TRAIL ARM","+ ADD ARM CONDITION"],
 longLimitTrail:["LONG LIMIT TRAIL CONDITION","LONG LIMIT TRAIL","+ ADD TRAIL CONDITION"],
 shortLimitTrailArm:["SHORT LIMIT TRAIL ARM CONDITION","SHORT LIMIT TRAIL ARM","+ ADD ARM CONDITION"],
 shortLimitTrail:["SHORT LIMIT TRAIL CONDITION","SHORT LIMIT TRAIL","+ ADD TRAIL CONDITION"],
 longReadyClose:["LONG READY CLOSE CONDITION","LONG READY CLOSE","+ ADD READY CLOSE CONDITION"],
 shortReadyClose:["SHORT READY CLOSE CONDITION","SHORT READY CLOSE","+ ADD READY CLOSE CONDITION"],
};

/* ==================== БҮХ ТАЛБАР = 3 JSON-ИЙН ТҮЛХҮҮР (нэр яг ижил) ==================== */
// Эх сурвалж: /ohlc/GOLD, /rsi/GOLD, /macd/GOLD. Nested түлхүүр нь JSON замаараа: cross_history.s30u, macd_peak.price
// kind: number | text | bool | time
const values = [];
const addKeys = (source, kind, keys) => keys.forEach(name => values.push({ name, source, kind }));

// ---- OHLC ----
const OHLC_CANDLE_KEYS = [];
[0, 1, 2, 3].forEach(n => ["open", "high", "low", "close"].forEach(k => OHLC_CANDLE_KEYS.push(`candle_${k}_${n}`)));
addKeys("OHLC", "number", [...OHLC_CANDLE_KEYS, "min_open", "max_open", "min_close", "max_close", "max_high", "min_low"]);
addKeys("OHLC", "bool", ["openup", "opendown"]);
addKeys("OHLC", "number", ["openup_limit", "opendown_limit"]);

// ---- RSI ----
addKeys("RSI", "number", ["rsi0", "rsi1", "rsi2", "rsi3"]);
addKeys("RSI", "text", ["30_up", "70_up", "30_down", "70_down"]);
["s30u", "s30d", "s70u", "s70d"].forEach(s => {
    values.push({ name: `cross_history.${s}`, source: "RSI", kind: "number" });
    values.push({ name: `cross_history.${s}_time`, source: "RSI", kind: "time" });
    values.push({ name: `cross_history.${s}_prev`, source: "RSI", kind: "number" });
    values.push({ name: `cross_history.${s}_prev_time`, source: "RSI", kind: "time" });
});
addKeys("RSI", "text", ["trend"]);
addKeys("RSI", "number", ["average_status"]);
addKeys("RSI", "text", ["last_status"]);
addKeys("RSI", "time", ["last_status_time"]);

// ---- MACD ----
["macd_line", "macd_signal", "macd_histogram"].forEach(m =>
    addKeys("MACD", "number", [`latest_${m}`, `previous_${m}`, `previous_2_${m}`, `previous_3_${m}`, `previous_4_${m}`]));
addKeys("MACD", "bool", ["macd_upcross", "macd_downcross", "macd_line_up", "macd_line_down", "macd_up", "macd_down"]);
addKeys("MACD", "text", ["macd_trend"]);
addKeys("MACD", "number", ["macd_min", "macd_max", "macd_average", "macd_uplimit", "macd_downlimit", "uplimit_cross_line", "downlimit_cross_line"]);
addKeys("MACD", "number", ["last_peak.macd_value", "last_peak.price", "last_trough.macd_value", "last_trough.price"]);
addKeys("MACD", "time", ["last_peak.time", "last_trough.time"]);
["macd_initial_up", "macd_initial_down", "signal_initial_up", "signal_initial_down"].forEach(p => {
    values.push({ name: `${p}_price`, source: "MACD", kind: "number" });
    values.push({ name: `${p}_time`, source: "MACD", kind: "time" });
});
addKeys("MACD", "number", ["macd_peak.macd_value", "macd_peak.price", "macd_trough.macd_value", "macd_trough.price"]);

// text талбаруудын мэдэгдэж буй утгууд (right side-д select болж харагдана)
const ENUMS = {
    "30_up": ["UP", "--"], "70_up": ["UP", "--"], "30_down": ["DOWN", "--"], "70_down": ["DOWN", "--"],
    last_status: ["30U", "30D", "70U", "70D", "None"],
    trend: ["uptrand1", "uptrand2", "downtrand1", "downtrand2", "None"],
    macd_trend: ["UP", "DOWN", "None"],
};

const CONDITION_VALUE_LABELS = {
    "macd_peak.macd_value": "macd_peak.macd_value (ACTIVE PEAK)",
    "macd_trough.macd_value": "macd_trough.macd_value (ACTIVE TROUGH)",
    "last_peak.macd_value": "last_peak.macd_value (CLOSED PEAK)",
    "last_trough.macd_value": "last_trough.macd_value (CLOSED TROUGH)"
};

/* DYNAMIC VALUES (позицийн төлөв — JSON биш) */
["LONG_COUNT", "SHORT_COUNT", "LONG_PNL", "SHORT_PNL", "TOTAL_FLOATING_PNL",
 "LAST_LONG_PNL", "LAST_SHORT_PNL", "MAX_LONG_PNL", "MAX_SHORT_PNL"]
    .forEach(name => values.push({ name, dynamic: true, source: "POSITION", kind: "number" }));
["MAX_LONG_REACHED", "MAX_SHORT_REACHED", "NOT_MAX_LONG_REACHED", "NOT_MAX_SHORT_REACHED"]
    .forEach(name => values.push({ name, dynamic: true, source: "POSITION", kind: "bool" }));

const P = (l,o,t,r) => [`${l} ${o} ${t==="number"?"NUMBER":r}`,l,o,t,r];
const V = (l,o,r) => P(l,o,"value",r);
const NUM = (l,o) => P(l,o,"number","");
const T = (l,o,r) => P(l,o,"text",r);
const rsi2 = (a,b,n) => ({
 label:`rsi1 ${a} ${n} AND rsi2 ${b} ${n}`,
 conditions:[["rsi1",a,"number",String(n)],["rsi2",b,"number",String(n),"AND"]]
});

const PRESETS = [
 V("candle_open_0",">","candle_open_1"), V("candle_open_0","<","candle_open_1"),
 V("candle_close_0",">","candle_open_0"), V("candle_close_0","<","candle_open_0"),
 V("candle_high_0",">","candle_high_1"), V("candle_low_0","<","candle_low_1"),

 P("candle_open_0",">","long_limit","LONG_LIMIT"), P("candle_open_0","<","long_limit","LONG_LIMIT"),
 P("candle_open_0",">","short_limit","SHORT_LIMIT"), P("candle_open_0","<","short_limit","SHORT_LIMIT"),

 NUM("rsi1",">"), NUM("rsi1","<"), V("rsi1",">","rsi2"), V("rsi1","<","rsi2"),
 rsi2(">","<",30), rsi2("<",">",30), rsi2(">","<",70), rsi2("<",">",70),

 T("last_status","==","30U"), T("last_status","==","70D"),
 T("30_up","==","UP"), T("70_down","==","DOWN"),
 T("trend","==","uptrand1"), T("trend","==","downtrand2"),

 // Дэвшилтэт холимог нөхцөллүүд (Advanced / Mixed Presets)
 {
  label: "candle_close_0 > average_status AND rsi1 < 30",
  conditions: [["candle_close_0", ">", "value", "average_status"], ["rsi1", "<", "number", "30", "AND"]]
 },
 {
  label: "candle_close_0 < average_status AND rsi1 > 70",
  conditions: [["candle_close_0", "<", "value", "average_status"], ["rsi1", ">", "number", "70", "AND"]]
 },
 {
  label: "candle_close_0 > openup_limit AND latest_macd_histogram > 0",
  conditions: [["candle_close_0", ">", "value", "openup_limit"], ["latest_macd_histogram", ">", "number", "0", "AND"]]
 },

 V("previous_macd_line",">","previous_macd_signal"), V("previous_macd_line","<","previous_macd_signal"),
 V("previous_macd_histogram",">","previous_2_macd_histogram"), V("previous_macd_histogram","<","previous_2_macd_histogram"),
 NUM("previous_macd_histogram",">"), NUM("previous_macd_histogram","<"),
 NUM("previous_macd_line",">"), NUM("previous_macd_line","<"),
 V("latest_macd_line",">","macd_peak.macd_value"),
 V("latest_macd_line","<","macd_trough.macd_value"),
 V("previous_macd_line",">","last_peak.macd_value"),
 V("previous_macd_line","<","last_trough.macd_value"),

 T("macd_upcross","==","true"), T("macd_downcross","==","true"),
 T("macd_up","==","true"), T("macd_down","==","true"),
 T("macd_trend","==","UP"), T("macd_trend","==","DOWN")
];

const condition = () => ({
 id: Date.now() + Math.random(), logic: "AND", left: "", operator: ">", right: "", rightType: "value", readyClose: false
});

const autoJSON = () => { if (typeof autoStrategyJSON === "function") autoStrategyJSON(); };

function addPreset(type, p) {
 if (!groups[type]) return console.error("Unknown condition group:", type);
 if (p.conditions) {
  p.conditions.forEach((x, i) => {
   const c = condition();
   Object.assign(c, { left: x[0], operator: x[1], rightType: x[2], right: x[3] });
   if (i) c.logic = x[4] || "AND";
   groups[type].push(c);
  });
 } else {
  const c = condition();
  Object.assign(c, { left: p[1], operator: p[2], rightType: p[3], right: p[4] });
  groups[type].push(c);
 }
 renderGroup(type);
 preview(type);
}

const closeMenus = () => document.querySelectorAll(".advanced-menu").forEach(x => x.classList.remove("show"));

function toggleAdvanced(type) {
 const m = $(type + "AdvancedMenu"), open = m.classList.contains("show");
 closeMenus();
 if (!open) m.classList.add("show");
}

document.addEventListener("click", e => {
 if (!e.target.closest(".advanced-wrap")) closeMenus();
});

function buildAdvancedMenu(type) {
 const m = $(type + "AdvancedMenu");
 m.innerHTML = PRESETS.map((p, i) =>
  `<button type="button" class="advanced-item" data-i="${i}">${p.conditions ? p.label : p[0]}</button>`
 ).join("");
 m.querySelectorAll(".advanced-item").forEach(b => {
  b.onclick = () => { addPreset(type, PRESETS[+b.dataset.i]); m.classList.remove("show"); };
 });
}

const def = name => values.find(x => x.name === name);
const N0 = v => Number(v ?? 0);

const dynGet = {
 LONG_COUNT: c => N0(c.longCount),
 SHORT_COUNT: c => N0(c.shortCount),
 LONG_PNL: c => N0(c.longPnl),
 SHORT_PNL: c => N0(c.shortPnl),
 TOTAL_FLOATING_PNL: c => N0(c.totalFloatingPnl),
 LAST_LONG_PNL: c => c.lastLongPnl ?? null,
 LAST_SHORT_PNL: c => c.lastShortPnl ?? null,
 MAX_LONG_PNL: c => c.maxLongPnl ?? null,
 MAX_SHORT_PNL: c => c.maxShortPnl ?? null,
 MAX_LONG_REACHED: c => N0(c.longCount) >= Number(maxPositions.LONG),
 MAX_SHORT_REACHED: c => N0(c.shortCount) >= Number(maxPositions.SHORT),
 NOT_MAX_LONG_REACHED: c => N0(c.longCount) < Number(maxPositions.LONG),
 NOT_MAX_SHORT_REACHED: c => N0(c.shortCount) < Number(maxPositions.SHORT),
};

function val(name, i, ctx = {}) {
    if (dynGet[name]) return dynGet[name](ctx);
    
    const data = ctx.data || candles;
    if (i < 0 || i >= data.length || !data[i]) return null;

    const candle = data[i];

    const candleField = /^candle_(open|high|low|close)_(\d+)$/.exec(name);
    if (candleField) {
        const sourceCandle = data[i - Number(candleField[2])];
        const fieldValue = sourceCandle?.[candleField[1]];
        return toNum(fieldValue);
    }

    // 1. Хэрэв шууд лааны объект дотор байвал (жишээ нь: open, close, high, low, volume)
    if (candle[name] !== undefined && candle[name] !== null) {
        if (typeof candle[name] === "boolean") return candle[name];
        const x = Number(candle[name]);
        return Number.isFinite(x) ? x : candle[name];
    }

    // 2. Flatten болсон объект эсвэл бусад шинж чанарууд
    const raw = candle[name];
    if (raw !== null && raw !== undefined && raw !== "") {
        const d = def(name);
        if (d && d.kind === "number") return toNum(raw);
        return raw;
    }

    return null;
}

const isUsable = x => x !== null && x !== undefined && !(typeof x === "number" && !Number.isFinite(x));

function compare(a, o, b) {
 if (a === null || b === null) return null;
 return { ">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b, "==": a === b, "!=": a !== b }[o] ?? null;
}

function evalCondition(c, i, ctx = {}) {
    if (!c.left) return null;
    if (c.readyClose && ctx.armed === false) return false;
    if ((c.rightType === "value" || c.rightType === "number" || c.rightType === "text") && !c.right) return null;

    const kind = def(c.left)?.kind;
    const a = val(c.left, i, ctx);
    const b =
        c.rightType === "number" ? toNum(c.right)
        : c.rightType === "text" ? (kind === "bool" ? (c.right === "true" ? true : c.right === "false" ? false : null) : String(c.right))
        : c.rightType === "long_limit" ? toNum(ctx.longLimit)
        : c.rightType === "short_limit" ? toNum(ctx.shortLimit)
        : val(c.right, i, ctx);

    return isUsable(a) && isUsable(b) ? compare(a, c.operator, b) : null;
}

function evalGroup(list, i, ctx = {}) {
 if (!list.length) return false;
 let r = null;
 for (let n = 0; n < list.length; n++) {
  const x = evalCondition(list[n], i, ctx);
  if (x === null) return null;
  r = n ? (list[n].logic === "AND" ? r && x : r || x) : x;
 }
 return r;
}

function valueOptionsHtml() {
 const bySource = {};
 values.forEach(v => (bySource[v.source] = bySource[v.source] || []).push(v));
 return Object.entries(bySource).map(([src, list]) =>
    `<optgroup label="${src}">` + list.map(x => `<option value="${x.name}">${CONDITION_VALUE_LABELS[x.name] || x.name}</option>`).join("") + `</optgroup>`
 ).join("");
}

function makeSelect(current, placeholder, fn) {
 const s = document.createElement("select");
 s.innerHTML = `<option value="">${placeholder}</option>` + valueOptionsHtml();
 s.value = current;
 s.onchange = () => fn(s.value);
 return s;
}

// Зүүн талын талбарын төрөл солигдоход баруун талын төрлийг тохируулна (number ↔ text/bool)
function onLeftChange(c, v, type) {
 c.left = v;
 const k = def(v)?.kind;
 if (k === "number" && c.rightType === "text") { c.rightType = "number"; c.right = ""; }
 else if (k && k !== "number" && c.rightType === "number") { c.rightType = "text"; c.right = ""; }
 renderGroup(type);
 preview(type);
}

// TEXT / BOOL баруун тал: bool → true/false, мэдэгдэх enum → select, бусад → text input
function textControl(c, type) {
 const kind = def(c.left)?.kind;
 const opts = kind === "bool" ? ["true", "false"] : ENUMS[c.left];
 if (opts) {
  return plainSelect(
   '<option value="">SELECT</option>' + opts.map(o => `<option value="${o}">${o}</option>`).join(""),
   c.right || "", v => { c.right = v; preview(type); }
  );
 }
 const inp = document.createElement("input");
 inp.type = "text";
 inp.placeholder = kind === "time" ? "YYYY-MM-DD HH:MM:SS" : "TEXT";
 inp.value = c.right || "";
 inp.oninput = () => { c.right = inp.value; preview(type); };
 return inp;
}

function plainSelect(html, value, fn, cls) {
 const s = document.createElement("select");
 if (cls) s.className = cls;
 s.innerHTML = html;
 s.value = value;
 s.onchange = () => fn(s.value);
 return s;
}

const OPS = [">", "<", ">=", "<=", "==", "!="].map(o => `<option value='${o}'>${o.replace(/</g, "&lt;")}</option>`).join("");

function renderGroup(type) {
 const box = $(type + "Box");
 if (!box) return;

 box.innerHTML = "";
 box.className = "condition-box";

 groups[type].forEach((c, i) => {
  const r = document.createElement("div");
  r.className = "condition-row";

  if (i) r.appendChild(plainSelect(
   "<option value='AND'>AND</option><option value='OR'>OR</option>",
   c.logic || "AND", v => { c.logic = v; preview(type); }, "condition-logic"
  ));

  r.appendChild(makeSelect(c.left, "LEFT VALUE", v => onLeftChange(c, v, type)));
  r.appendChild(plainSelect(OPS, c.operator || ">", v => { c.operator = v; preview(type); }));

  r.appendChild(plainSelect(
   '<option value="value">VALUE</option><option value="number">NUMBER</option><option value="text">TEXT / BOOL</option>' +
   '<option value="long_limit">LONG LIMIT</option><option value="short_limit">SHORT LIMIT</option>',
   c.rightType || "value",
   v => {
    c.rightType = v;
    c.right = v === "long_limit" ? "LONG_LIMIT" : v === "short_limit" ? "SHORT_LIMIT" : "";
    renderGroup(type); preview(type);
   } 
  ));

  if (c.rightType === "value") {
   r.appendChild(makeSelect(c.right, "RIGHT VALUE", v => { c.right = v; preview(type); }));
  } else if (c.rightType === "text") {
   r.appendChild(textControl(c, type));
  } else {
   const inp = document.createElement("input");
   if (c.rightType === "long_limit" || c.rightType === "short_limit") {
    inp.type = "text";
    inp.value = c.right || (c.rightType === "long_limit" ? "LONG LIMIT" : "SHORT LIMIT");
    inp.disabled = true;
   } else {
    inp.type = "number";
    inp.step = "any";
    inp.placeholder = "NUMBER";
    inp.value = c.right || "";
    inp.oninput = () => { c.right = inp.value; preview(type); };
   }
   r.appendChild(inp);
  }

  if (/Exit$/.test(type)) {
   r.classList.add("has-ready");
   r.appendChild(plainSelect(
    '<option value="0">NO READY</option><option value="1">WITH READY</option>',
    c.readyClose ? "1" : "0",
    v => { c.readyClose = v === "1"; preview(type); }
   ));
  }

  const del = document.createElement("button");
  del.textContent = "✕";
  del.title = "Delete condition";
  del.onclick = () => {
   groups[type] = groups[type].filter(x => x.id !== c.id);
   renderGroup(type);
   preview(type);
  };
  r.appendChild(del);

  box.appendChild(r);
 });
}

function text(list) {
 if (!list.length) return "No conditions";
 return list.map((c, i) =>
  (i ? c.logic + " " : "") + `${c.left || "LEFT"} ${c.operator} ${c.right || (c.rightType === "number" ? "NUMBER" : "RIGHT")}` + (c.readyClose ? " [READY]" : "")
 ).join(" ");
}

function preview(type) {
 const el = $(type + "Preview");
 if (el) el.textContent = text(groups[type]);
 autoJSON();
}

function add(type) {
 groups[type].push(condition());
 renderGroup(type);
 preview(type);
}

function updateModeVisibility(side) {
 const resetType = side === "LONG" ? "longReset" : "shortReset";
 const box = $(resetType + "Box");
 const section = box && box.closest(".section");
 if (!section) return;

 if (positionMode[side] === "MANY") {
  section.style.display = "";
 } else {
  section.style.display = "none";
  groups[resetType] = [];
  renderGroup(resetType);
  preview(resetType);
 }
}

function updateLimitTrailVisibility(side) {
 const key = side.toLowerCase();
 const panel = $(key + "LimitTrailPanel");
 if (panel) panel.style.display = limitTrailEnabled[side] ? "" : "none";
}

function buildGroups() {
 const root = $("groups");
 root.innerHTML = "";

 [
  ["longOpen","LONG OPEN CONDITION","LONG"],
  ["longReset","LONG RESET CONDITION","LONG"],
  ["longExit","LONG EXIT CONDITION","LONG"],
  ["longReadyClose","LONG READY CLOSE CONDITION","LONG"],
  ["shortOpen","SHORT OPEN CONDITION","SHORT"],
  ["shortReset","SHORT RESET CONDITION","SHORT"],
  ["shortReadyClose","SHORT READY CLOSE CONDITION","SHORT"],
  ["shortExit","SHORT EXIT CONDITION","SHORT"]
 ].forEach(([type, title, side]) => {
  const key = side.toLowerCase();
  const isOpen = type === "longOpen" || type === "shortOpen";

    const modeHtml = isOpen ? `
   <div class="row"><div class="position-mode-row">
    <span class="position-mode-label">${side} POSITION MODE</span>
    <label class="position-option"><input type="radio" name="${key}PositionMode" value="SINGLE" checked> SINGLE POS</label>
    <label class="position-option"><input type="radio" name="${key}PositionMode" value="MANY"> MANY POS</label>
    <span id="${key}MaxPosWrap" class="max-pos-wrap" style="display:none">
     <label>MAX POS</label>
     <input id="${key}MaxPos" type="number" min="1" step="1" value="10">
    </span>
    </div></div>
    <div class="limit-trail-controls">
     <label class="range-toggle"><input id="${key}LimitTrailEnabled" type="checkbox"> TRAIL ${side} LIMIT</label>
     <div id="${key}LimitTrailPanel" class="limit-trail-panel" style="display:none">
            <div class="section-title">${side} ARM CONDITION</div>
            <div id="${key}LimitTrailArmBox"></div>
            <div class="advanced-wrap">
                <button type="button" id="${key}LimitTrailArmAdvanced">ADVANCED ARM CONDITIONS ▼</button>
                <div id="${key}LimitTrailArmAdvancedMenu" class="advanced-menu"></div>
            </div>
            <button type="button" id="${key}LimitTrailArmAdd">+ ADD ARM CONDITION</button>
            <button type="button" id="${key}LimitTrailArmPrev">PREVIEW ARM</button>
            <div id="${key}LimitTrailArmPreview" class="preview">No conditions</div>

            <div class="section-title limit-trail-update-title">${side} LIMIT UPDATE CONDITION</div>
      <div id="${key}LimitTrailBox"></div>
      <div class="advanced-wrap">
        <button type="button" id="${key}LimitTrailAdvanced">ADVANCED CONDITIONS ▼</button>
        <div id="${key}LimitTrailAdvancedMenu" class="advanced-menu"></div>
      </div>
      <button type="button" id="${key}LimitTrailAdd">+ ADD TRAIL CONDITION</button>
      <button type="button" id="${key}LimitTrailPrev">PREVIEW</button>
      <div id="${key}LimitTrailPreview" class="preview">No conditions</div>
    <label class="range-toggle limit-trail-reset-toggle"><input id="${key}LimitTrailReset" type="checkbox"> WITH LIMIT RESET</label>
     </div>
    </div>` : "";

  const s = document.createElement("div");
  s.className = "section";
  s.innerHTML = `
    <div class="section-title section-heading">
     <span>${title}</span>
     <button type="button" id="${type}Collapse" class="section-collapse-toggle" aria-controls="${type}Content" aria-expanded="false" title="Expand ${title.toLowerCase()}">+</button>
    </div>
    <div id="${type}Content" class="section-collapse-content" hidden>
   ${modeHtml}
   <div id="${type}Box"></div>
   <div class="advanced-wrap">
    <button type="button" id="${type}Advanced">ADVANCED CONDITIONS ▼</button>
    <div id="${type}AdvancedMenu" class="advanced-menu"></div>
   </div>
   <button type="button" id="${type}Add">${CFG[type][2]}</button>
   <button type="button" id="${type}Prev">PREVIEW</button>
    <div id="${type}Preview" class="preview ${/Exit|Reset|ReadyClose/.test(type) ? "exit" : ""}">No conditions</div>
    </div>`;
  root.appendChild(s);

  const collapseButton = $(type + "Collapse");
  collapseButton.onclick = () => {
    const content = $(type + "Content");
    const expand = content.hidden;
    content.hidden = !expand;
    collapseButton.textContent = expand ? "−" : "+";
    collapseButton.setAttribute("aria-expanded", String(expand));
    collapseButton.title = `${expand ? "Collapse" : "Expand"} ${title.toLowerCase()}`;
  };

  if (isOpen) {
   document.querySelectorAll(`input[name="${key}PositionMode"]`).forEach(radio => {
    radio.onchange = () => {
     positionMode[side] = radio.value;
     const wrap = $(key + "MaxPosWrap"), input = $(key + "MaxPos");
     if (wrap) wrap.style.display = radio.value === "MANY" ? "inline-flex" : "none";
     if (input) {
      const setMax = () => {
       const n = parseInt(input.value, 10);
       maxPositions[side] = (positionMode[side] === "MANY" && Number.isInteger(n) && n >= 1) ? n : 1;
      };
      input.oninput = setMax;
      setMax();
     }
     updateModeVisibility(side);
    };
   });

    const trailArmType = key + "LimitTrailArm";
    const trailType = key + "LimitTrail";
    const trailToggle = $(key + "LimitTrailEnabled");
    const trailReset = $(key + "LimitTrailReset");
    trailToggle.checked = limitTrailEnabled[side];
    trailReset.checked = limitTrailReset[side];
    trailToggle.onchange = () => {
     limitTrailEnabled[side] = trailToggle.checked;
     updateLimitTrailVisibility(side);
     autoJSON();
    };
    trailReset.onchange = () => {
     limitTrailReset[side] = trailReset.checked;
     autoJSON();
    };
    $(trailArmType + "Advanced").onclick = () => toggleAdvanced(trailArmType);
    $(trailArmType + "Add").onclick = () => add(trailArmType);
    $(trailArmType + "Prev").onclick = () => preview(trailArmType);
    buildAdvancedMenu(trailArmType);
    $(trailType + "Advanced").onclick = () => toggleAdvanced(trailType);
    $(trailType + "Add").onclick = () => add(trailType);
    $(trailType + "Prev").onclick = () => preview(trailType);
    buildAdvancedMenu(trailType);
    updateLimitTrailVisibility(side);
  }

  $(type + "Advanced").onclick = () => toggleAdvanced(type);
  $(type + "Add").onclick = () => add(type);
  $(type + "Prev").onclick = () => preview(type);
  buildAdvancedMenu(type);
 });

 ["LONG", "SHORT"].forEach(side => {
  const key = side.toLowerCase();
  const radio = document.querySelector(`input[name="${key}PositionMode"][value="${positionMode[side]}"]`);
  if (radio) radio.checked = true;
 });
 Object.keys(groups).forEach(t => {
  renderGroup(t);
  const el = $(t + "Preview");
  if (el) el.textContent = text(groups[t]);
 });
 updateModeVisibility("LONG");
 updateModeVisibility("SHORT");
}

buildGroups();
