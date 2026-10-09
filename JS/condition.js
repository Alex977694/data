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
        if (k === "symbol" || def(k)) return;
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
        const BASE = "https://web-production-c3082.up.railway.app";
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

        // JSON-ийн утгууд нь зөвхөн ЭЦСИЙН (live) лаанд хамаарна. Түүхэн лаанд null (хэрэгжихгүй).
        const snapshot = { ...ohlcFlat, ...rsiFlat, ...macdFlat };
        delete snapshot.symbol;
        const lastIdx = data.candles.length - 1;
        window.candles = data.candles.map((c, index) => ({
            ...c,
            ...(index === lastIdx ? snapshot : {}),
            bid: Number(c.close),
            ask: Number(c.close)
        }));

        console.log("✅ Candles + JSON fields loaded:", window.candles.length);
        if(status) status.textContent = `✅ GOLD data & Indicators loaded — ${window.candles.length} candles`;

        refreshGroups();
        if (typeof applyIndicators === "function") applyIndicators();

    } catch (e) {
        console.error("❌ Failed to load candles or indicators:", e);
        if(status) status.textContent = "❌ Failed to load data: " + e.message;
    }
}

const positionMode = { LONG: "SINGLE", SHORT: "SINGLE" };
const maxPositions = { LONG: 1, SHORT: 1 };

const indicatorSettings = {
    rsiPeriod: 7, rsiSource: "close",
    macdFast: 12, macdSlow: 26, macdSignal: 9,
};

const groups = {
 longOpen:[], longReset:[], longExit:[], longReadyClose:[],
 shortOpen:[], shortReset:[], shortExit:[], shortReadyClose:[]
};

const CFG = {
 longOpen:["LONG OPEN CONDITION","LONG OPEN","+ ADD CONDITION"],
 longReset:["LONG RESET CONDITION","LONG RESET","+ ADD RESET CONDITION"],
 longExit:["LONG EXIT CONDITION","LONG EXIT","+ ADD EXIT CONDITION"],
 shortOpen:["SHORT OPEN CONDITION","SHORT OPEN","+ ADD CONDITION"],
 shortReset:["SHORT RESET CONDITION","SHORT RESET","+ ADD RESET CONDITION"],
 shortExit:["SHORT EXIT CONDITION","SHORT EXIT","+ ADD EXIT CONDITION"],
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

// Талбарын нэр = JSON түлхүүр. Утгыг data[i][нэр]-ээс шууд авна (offset байхгүй: rsi0..rsi3, candle_open_0..3 гэх мэт
// түлхүүрүүд өөрсдөө түүхийг агуулсан). null/хоосон → null (0 биш).
function val(name, i, ctx = {}) {
    if (dynGet[name]) return dynGet[name](ctx);
    const d = def(name);
    if (!d) return null;
    const data = ctx.data || candles;
    if (i < 0 || i >= data.length || !data[i]) return null;
    const raw = data[i][name];
    if (raw === null || raw === undefined || raw === "") return null;
    if (d.kind === "number") return toNum(raw);
    if (d.kind === "bool") return raw === true || raw === "true" ? true : (raw === false || raw === "false" ? false : null);
    return String(raw); // text, time (time нь "YYYY-MM-DD HH:MM:SS" тул тэмдэгт мөрөөр харьцуулахад зөв)
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
  `<optgroup label="${src}">` + list.map(x => `<option value="${x.name}">${x.name}</option>`).join("") + `</optgroup>`
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
   </div></div>` : "";

  const s = document.createElement("div");
  s.className = "section";
  s.innerHTML = `
   <div class="section-title">${title}</div>
   ${modeHtml}
   <div id="${type}Box"></div>
   <div class="advanced-wrap">
    <button type="button" id="${type}Advanced">ADVANCED CONDITIONS ▼</button>
    <div id="${type}AdvancedMenu" class="advanced-menu"></div>
   </div>
   <button type="button" id="${type}Add">${CFG[type][2]}</button>
   <button type="button" id="${type}Prev">PREVIEW</button>
   <div id="${type}Preview" class="preview ${/Exit|Reset|ReadyClose/.test(type) ? "exit" : ""}">No conditions</div>`;
  root.appendChild(s);

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

initMarketData();
buildGroups();
