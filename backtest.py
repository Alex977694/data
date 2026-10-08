from flask import Flask, jsonify, render_template_string, request, send_from_directory
import os
import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JS_DIR = os.path.join(BASE_DIR, "JS")

app = Flask(__name__)

RAILWAY_GOLD_URL = (
    "https://web-production-c3082.up.railway.app/candles/GOLD"
)


def load_backtest_data(limit=None):
    try:
        r = requests.get(
            RAILWAY_GOLD_URL,
            timeout=30
        )

        r.raise_for_status()

        payload = r.json()

        if "candles" not in payload:
            raise KeyError(
                "Railway response does not contain 'candles'"
            )

        raw = payload["candles"]

        if not isinstance(raw, list):
            raise ValueError("'candles' must be a list")

        if limit is not None:
            limit = int(limit)

            if limit <= 0:
                raise ValueError(
                    "Candle limit must be greater than 0"
                )

            raw = raw[-limit:]

        candles = []

        for row in raw:

            if len(row) < 6:
                continue

            candles.append({
                "open_time": float(row[0]),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),

                "rsi": None,
                "macd_line": None,
                "macd_signal": None,
                "macd_histogram": None,

                "bid": float(row[4]),
                "ask": float(row[4]) + 0.30
            })

        if not candles:
            raise ValueError(
                "Railway returned no valid GOLD candles"
            )

        print(
            f"[RAILWAY] Loaded {len(candles)} GOLD candles"
        )

        return candles

    except requests.RequestException as e:

        raise RuntimeError(
            f"Railway GOLD API request failed: {e}"
        )

HTML=r"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/JS/style.css">
<title>GOLD 1M Hedge Strategy Builder</title>
</head>
<body>

<h1>GOLD 1M Hedge Strategy Builder</h1>
<div id="status" class="status">Loading GOLD data...</div>

<!-- STRATEGY SAVE / LOAD -->
<div class="section">
<div class="section-title">STRATEGY SAVE / LOAD</div>
<div class="strategy-tools">
<button id="copyStrategy">COPY JSON</button>
<button id="pasteStrategy">PASTE JSON</button>
<button id="exportStrategy" class="run">EXPORT JSON</button>
<button id="importStrategy">IMPORT JSON</button>
<button id="clearStrategy">CLEAR</button>
<input id="strategyFile" type="file" accept=".json,application/json" style="display:none">
</div>
<textarea id="strategyJson" class="strategy-json" spellcheck="false" placeholder="Strategy JSON энд харагдана. JSON paste хийгээд IMPORT JSON дарж болно."></textarea>
</div>

<div id="groups"></div>

<div class="section">
<div class="section-title">ACCOUNT SETTINGS</div>
<div class="row">
<label>BALANCE $</label><input id="accBalance" type="number" min="1" step="any" value="1000">
<label>LEVERAGE 1:</label><input id="accLeverage" type="number" min="1" step="1" value="100">
<label>LOT</label><input id="accLot" type="number" min="0.01" step="0.01" value="0.01">
</div>
<div class="row">
<label>CONTRACT SIZE</label><input id="accContract" type="number" min="1" step="any" value="100">
<label>STOP-OUT %</label><input id="accStopOut" type="number" min="1" step="1" value="50">
<label class="range-toggle"><input id="accHedged" type="checkbox"> HEDGED MARGIN</label>
</div>
<div class="preview">HEDGED MARGIN унтраалттай бол LONG ба SHORT бүрийн margin нийлбэрээр бодогдоно (консерватив).</div>
</div>

<div class="section">
<div class="section-title">BACKTEST</div>
<div class="row">
<button id="run" class="run">RUN HEDGE BACKTEST</button>

<label class="range-toggle">
<input id="addRange" type="checkbox">
ADD RANGE
</label>

<select id="rangeMode" class="range-select" style="display:none;">
<option value="last">LAST N DAYS</option>
<option value="block">DAY N</option>
</select>

<select id="rangeDay" class="range-day" style="display:none;">
<option value="1">1</option>
<option value="2">2</option>
<option value="3">3</option>
<option value="4">4</option>
<option value="5">5</option>
<option value="6">6</option>
<option value="7">7</option>
</select>

<span id="rangePreview" class="range-preview" style="display:none;">-</span>
</div>

<div id="backtestStatus" class="preview">
</div>

<div class="section">
<div class="section-title">TRADE RESULTS</div>
<div class="results" id="results"></div>
<div id="tradeLog" class="log"></div>
</div>

<div class="section">
<div class="section-title">BACKTEST STATISTICS</div>
<div class="stats" id="stats"></div>
</div>

<div class="section">
<div class="section-title">ACCOUNT STATISTICS</div>
<div class="stats" id="accStats"></div>
<div id="accNote" class="preview"></div>
</div>

<div class="section">
<div class="section-title">OPENED TRADE DETAILS</div>
<div id="openedLog" class="log"></div>
</div>

<div class="section">
<div class="section-title">COMPLETED TRADE DETAILS</div>
<div id="completedLog" class="log"></div>
</div>

<div class="section" id="chartSection">

    <!-- CHART HEADER -->
    <div class="section-title chart-title">

        <span>META CHART</span>

        <div class="chart-tools">

            <button
                id="toggleIndicators"
                class="chart-tool">
                INDICATORS
            </button>

            <button
                id="toggleChartSettings"
                class="chart-tool">
                ⚙
            </button>

        </div>

    </div>


    <!-- INDICATOR SETTINGS -->
    <div
        id="chartSettings"
        class="chart-settings"
        style="display:none;"
    >

        <!-- RSI -->
        <div class="chart-setting-group">

            <label class="indicator-toggle">

                <input
                    id="showRSI"
                    type="checkbox"
                    checked
                >

                <span>RSI</span>

            </label>

            <label>PERIOD</label>

            <input
                id="rsiPeriod"
                type="number"
                min="2"
                step="1"
                value="7"
            >

            <label>SOURCE</label>

            <select id="rsiSource">

                <option value="open">
                    OPEN
                </option>

                <option value="high">
                    HIGH
                </option>

                <option value="low">
                    LOW
                </option>

                <option
                    value="close"
                    selected
                >
                    CLOSE
                </option>

            </select>

        </div>


        <!-- MACD -->
        <div class="chart-setting-group">

            <label class="indicator-toggle">

                <input
                    id="showMACD"
                    type="checkbox"
                    checked
                >

                <span>MACD</span>

            </label>

            <label>FAST</label>

            <input
                id="macdFast"
                type="number"
                min="1"
                step="1"
                value="12"
            >

            <label>SLOW</label>

            <input
                id="macdSlow"
                type="number"
                min="2"
                step="1"
                value="26"
            >

            <label>SIGNAL</label>

            <input
                id="macdSignal"
                type="number"
                min="1"
                step="1"
                value="9"
            >

        </div>


        <button
            id="applyIndicators"
            class="run"
        >
            APPLY
        </button>
        </div>

        <div id="indicatorStatus" class="preview">
            RSI / MACD READY
        </div>

    </div>


    <!-- ACTUAL CHART -->
    <div
        id="metaChartContainer"
        style="
            width:100%;
            height:750px;
            background:#111827;
            border-radius:8px;
            overflow:hidden;
        "
    ></div>

</div>

<div class="section">
<div class="section-title">DATA</div>
<div id="dataInfo" class="data-info">-</div>
</div>

<script src="/JS/META_CHART.js?v=5"></script>
<script>

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    const indicatorBtn = document.getElementById("toggleIndicators");
    const settingsBtn = document.getElementById("toggleChartSettings");
    const settings = document.getElementById("chartSettings");

    /*
     * INDICATORS button
     * RSI / MACD indicator panel-ийг show/hide хийнэ.
     */
    if (indicatorBtn) {

        indicatorBtn.addEventListener("click", () => {

            const rsi = document.getElementById("showRSI");
            const macd = document.getElementById("showMACD");

            if (rsi) {
                rsi.checked = !rsi.checked;
            }

            if (macd) {
                macd.checked = !macd.checked;
            }

            if (typeof window.redrawChart === "function") {
                window.redrawChart();
            }

        });

    }


    /*
     * ⚙ button
     * RSI / MACD settings panel-ийг нээнэ.
     */
    if (settingsBtn && settings) {

        settingsBtn.addEventListener("click", () => {

            const hidden =
                settings.style.display === "none" ||
                settings.style.display === "";

            settings.style.display =
                hidden ? "block" : "none";

        });

    }


    /*
     * APPLY button
     */
    const applyBtn =
        document.getElementById("applyIndicators");

    if (applyBtn) {

        applyBtn.addEventListener("click", () => {

            if (typeof window.applyIndicators === "function") {
                window.applyIndicators();
            }

        });

    }

})

window.candles = [];

const getCandles = () =>
    Array.isArray(window.candles)
        ? window.candles
        : [];

window.$ = id => document.getElementById(id);

const MINUTES_PER_DAY=1440;
const sum=a=>a.reduce((x,y)=>x+y,0);
const nulls=n=>new Array(n).fill(null);
const fin=Number.isFinite;

function sourceValue(c,s){const x=Number(c[s]);return fin(x)?x:null}

function calculateRSI(data,p,source){
 const out=nulls(data.length);
 if(data.length<=p)return out;
 const pr=data.map(c=>sourceValue(c,source));
 let gs=0,ls=0;
 for(let i=1;i<=p;i++){const d=pr[i]-pr[i-1];d>0?gs+=d:ls-=d}
 let ag=gs/p,al=ls/p;
 const rv=(g,l)=>l===0?(g===0?50:100):100-100/(1+g/l);
 out[p]=rv(ag,al);
 for(let i=p+1;i<data.length;i++){
  const d=pr[i]-pr[i-1];
  ag=(ag*(p-1)+(d>0?d:0))/p;
  al=(al*(p-1)+(d<0?-d:0))/p;
  out[i]=rv(ag,al);
 }
 return out;
}

function calculateEMA(data,p){
 const out=nulls(data.length);
 if(data.length<p)return out;
 let ema=sum(data.slice(0,p))/p;
 out[p-1]=ema;
 const m=2/(p+1);
 for(let i=p;i<data.length;i++){ema=(data[i]-ema)*m+ema;out[i]=ema}
 return out;
}

function calculateMACD(data,fast,slow,signal){
 const close=data.map(c=>Number(c.close));
 const fe=calculateEMA(close,fast),se=calculateEMA(close,slow);
 const line=data.map((_,i)=>fin(fe[i])&&fin(se[i])?fe[i]-se[i]:null);
 const valid=[],idx=[];
 line.forEach((x,i)=>{if(fin(x)){valid.push(x);idx.push(i)}});
 const sig=nulls(data.length);
 calculateEMA(valid,signal).forEach((x,i)=>{if(fin(x))sig[idx[i]]=x});
 const histogram=data.map((_,i)=>fin(line[i])&&fin(sig[i])?line[i]-sig[i]:null);
 return{line,signal:sig,histogram};
}

/* side: -1 negative cycle (track MIN), 1 positive cycle (track MAX), 0 not started */
function calculateMACDZeroCrossExtremes(data){
 const n=data.length,lastStatus=nulls(n),prevMin=nulls(n),prevMax=nulls(n);
 let side=0,cur=null,runLen=0,cMin=null,cMax=null;
 for(let i=0;i<n;i++){
  const line=Number(data[i].macd_line);
  if(fin(line)&&line!==0){
   const ns=line>0?1:-1;
   if(side===0){side=ns;cur=line;runLen=1}
   else if(ns===side){
    runLen++;
    if(side<0?line<cur:line>cur)cur=line;     // running экстремум
   }else{
    /* тэмдэг эргэлээ: дууссан цуваа >= 2 свеч байсан бол л шинэчилнэ */
    if(runLen>=2){
     if(side>0)cMax=cur;   // line1<0, line2>0, line3>0
     else cMin=cur;        // line1>0, line2<0, line3<0
    }
    side=ns;cur=line;runLen=1;
   }
  }
  lastStatus[i]=cur;prevMin[i]=cMin;prevMax[i]=cMax;
 }
 return{lastStatus,prevMin,prevMax};
}

function applyIndicators(){
 const rp=parseInt($("rsiPeriod").value.trim(),10);
 const rs=$("rsiSource").value;

 const mf=parseInt($("macdFast").value,10);
 const ms=parseInt($("macdSlow").value,10);
 const mg=parseInt($("macdSignal").value,10);

 if(!Number.isInteger(rp)||rp<2)
   return alert("RSI PERIOD must be 2 or greater.");

 if(!Number.isInteger(mf)||!Number.isInteger(ms)||!Number.isInteger(mg))
   return alert("MACD settings are invalid.");

 if(ms<=mf)
   return alert("MACD SLOW must be greater than MACD FAST.");

window.indicatorSettings = window.indicatorSettings || {
    rsiPeriod: 7,
    rsiSource: "close",
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9
};

 Object.assign(indicatorSettings,{
   rsiPeriod:rp,
   rsiSource:rs,
   macdFast:mf,
   macdSlow:ms,
   macdSignal:mg
 });

if(!Array.isArray(candles) || candles.length === 0){
    const indicatorStatus = $("indicatorStatus");

    if(indicatorStatus){
        indicatorStatus.textContent = "No candle data";
    }

    return;
}

 const rsi=calculateRSI(candles,rp,rs);
 const macd=calculateMACD(candles,mf,ms,mg);

 candles.forEach((c,i)=>{
   c.rsi=rsi[i];
   c.macd_line=macd.line[i];
   c.macd_signal=macd.signal[i];
   c.macd_histogram=macd.histogram[i];
 });

 /* ==========================================
    UPDATE META CHART DIRECTLY
 ========================================== */

 window.allData=candles.map(c=>[
   Number(c.open_time),
   Number(c.open),
   Number(c.high),
   Number(c.low),
   Number(c.close),
   Number(c.volume)
 ]);

 window.rsiArrayData =
    candles.map(c => fin(Number(c.rsi)) ? Number(c.rsi) : null);

window.macdArrayData =
    candles.map(c => fin(Number(c.macd_line)) ? Number(c.macd_line) : null);

window.signalArrayData =
    candles.map(c => fin(Number(c.macd_signal)) ? Number(c.macd_signal) : null);

window.histArrayData =
    candles.map(c => fin(Number(c.macd_histogram)) ? Number(c.macd_histogram) : null);

 if(window.redrawChart){
   window.redrawChart();
 }

 $("indicatorStatus").textContent=
   `RSI ${rp} / ${rs.toUpperCase()} | MACD ${mf},${ms},${mg}`;

 $("dataInfo").textContent=
   `13 columns | ${candles.length} candles | RSI ${rp} ${rs.toUpperCase()} | MACD ${mf}/${ms}/${mg}`;
}

function time(x){
 let t=Number(x);
 if(!fin(t))return String(x??"-");
 if(t<1e11)t*=1000;
 return new Date(t).toISOString().replace("T"," ").replace(".000Z","");
}
const price=x=>fin(Number(x))?Number(x).toFixed(2):"-";
function pnl(x){x=Number(x);return fin(x)?(x>0?"+":"")+x.toFixed(2):"-"}

function trade(type,et,ep,xt,xp,limit){
 return{type,entryTime:et,entryPrice:ep,exitTime:xt,exitPrice:xp,limit,pnl:type==="LONG"?xp-ep:ep-xp};
}

function getOpenLimits(i){
    const opens = [0,1,2,3]
        .map(n => val("OPEN"+n, i))
        .filter(Number.isFinite);

    return {
        longLimit: opens.length ? Math.min(...opens) : null,
        shortLimit: opens.length ? Math.max(...opens) : null
    };
}

function limitFor(type, i){
    const limits = getOpenLimits(i);
    return type === "LONG"
        ? limits.longLimit
        : limits.shortLimit;
}


/* ===== BACKTEST RANGE ===== */

function getBacktestRange(){
 const n=candles.length,all={start:0,end:n,count:n,mode:"ALL"};
 if(!$("addRange").checked)return all;
 const mode=$("rangeMode").value,day=parseInt($("rangeDay").value,10);
 if(mode==="last"){
  const start=Math.max(0,n-MINUTES_PER_DAY*day);
  return{start,end:n,count:n-start,mode:"LAST",days:day};
 }
 if(mode==="block"){
  const end=n-MINUTES_PER_DAY*(day-1);
  const start=Math.max(0,end-MINUTES_PER_DAY);
  const e=Math.max(0,Math.min(n,end));
  return{start,end:e,count:Math.max(0,e-start),mode:"DAY",days:day};
 }
 return all;
}

function updateRangeUI(){
 const on=$("addRange").checked,mode=$("rangeMode").value;
 ["rangeMode","rangeDay","rangePreview"].forEach(id=>$(id).style.display=on?"inline-block":"none");
 if(!on){$("rangePreview").textContent="ALL LOADED CANDLES";return}
 const day=parseInt($("rangeDay").value,10);
 $("rangePreview").textContent=mode==="last"
  ?`LAST ${day} DAY${day>1?"S":""} — ${Math.min(candles.length,MINUTES_PER_DAY*day)} CANDLES`
  :`DAY ${day} — ${getBacktestRange().count} CANDLES`;
}

/* ===== BACKTEST ===== */

function runBacktest(){
 const range=getBacktestRange();
 const activeCandles=candles.slice(range.start,range.end);
 if(!activeCandles.length)return alert("Selected range has no candles.");

 if(!groups.longOpen.length&&!groups.shortOpen.length)
  return alert("Add at least one LONG OPEN or SHORT OPEN condition.");
 for(const t of["LONG","SHORT"])
  if(positionMode[t]==="MANY"&&!groups[t.toLowerCase()+"Reset"].length)
   return alert(`${t} MANY POS requires ${t} RESET CONDITION.`);
 for(const t of["LONG","SHORT"]){
  const k=t.toLowerCase();
  if(groups[k+"Open"].length&&!groups[k+"Exit"].length)
   return alert(`${t} OPEN exists, but ${t} EXIT is empty.`);
 }

 const positions={LONG:[],SHORT:[]},ready={LONG:true,SHORT:true},armed={LONG:false,SHORT:false};
 const trades=[],events=[];
 const mxAll=calculateMACDZeroCrossExtremes(candles);
 const mx={
  lastStatus:mxAll.lastStatus.slice(range.start,range.end),
  prevMin:mxAll.prevMin.slice(range.start,range.end),
  prevMax:mxAll.prevMax.slice(range.start,range.end)
 };
 const count={LONG:{open:0,close:0,trades:0},SHORT:{open:0,close:0,trades:0}};

 const A={
  bal:Number($("accBalance").value)||1000,
  lev:Number($("accLeverage").value)||100,
  lot:Number($("accLot").value)||0.01,
  cs:Number($("accContract").value)||100,
  so:Number($("accStopOut").value)||50,
  hedged:$("accHedged").checked
 };
 A.k=A.lot*A.cs;                    // 1 USD үнийн зөрүү = A.k $
 const acc={closed:0,peak:A.bal,maxDD:0,minEq:A.bal,minFloat:0,maxPos:0,
  minML:null,need:0,soIndex:null,soTime:null,ddBars:0,bars:0,lastEq:A.bal};

 function openPosition(type,c,i){
  const ep=Number(type==="LONG"?c.ask:c.bid);
  const et=time(c.open_time);
  const limit=limitFor(type,i);

  positions[type].push({
    id:Date.now()+Math.random(),
    type,
    entryTime:et,
    entryPrice:ep,
    limit,
    peak:0
  });

  events.push({
    time:et,
    price:ep,
    limit,
    action:type+" OPEN"
  });

  count[type].open++;
  count[type].trades++;
  ready[type]=false;
 }

 function closePosition(type,index,c){
  const p=positions[type][index];
  if(!p)return;
  const xp=Number(type==="LONG"?c.bid:c.ask),xt=time(c.open_time);
  events.push({time:xt,price:xp,limit:p.limit,action:type+" CLOSE"});
  trades.push(trade(type,p.entryTime,p.entryPrice,xt,xp,p.limit));
  acc.closed+=trades[trades.length-1].pnl*A.k;
  count[type].close++;
  positions[type].splice(index,1);
 }

 const specs=["LONG","SHORT"].map(type=>{
  const k=type.toLowerCase();
  return{type,open:groups[k+"Open"],reset:groups[k+"Reset"],rc:groups[k+"ReadyClose"],exit:groups[k+"Exit"]};
 });

 activeCandles.forEach((c,i)=>{
  const lp=positions.LONG,sp=positions.SHORT;
  const bid=Number(c.bid),ask=Number(c.ask);
  const lpl=lp.map(p=>bid-Number(p.entryPrice));
  const spl=sp.map(p=>Number(p.entryPrice)-ask);
  const longPnl=sum(lpl),shortPnl=sum(spl);

  const dyn={
   longCount:lp.length,shortCount:sp.length,
   longPnl,shortPnl,totalFloatingPnl:longPnl+shortPnl,
   lastLongPnl:lpl.length?lpl[lpl.length-1]:null,
   lastShortPnl:spl.length?spl[spl.length-1]:null,
   maxLongPnl:lpl.length?Math.max(...lpl):null,
   maxShortPnl:spl.length?Math.max(...spl):null,
   macdLastStatus:i>0?mx.lastStatus[i-1]:null,
   macdPrevMin:i>0?mx.prevMin[i-1]:null,
   macdPrevMax:i>0?mx.prevMax[i-1]:null,
   maxLongReached:lp.length>=Number(maxPositions.LONG),
   maxShortReached:sp.length>=Number(maxPositions.SHORT),
   notMaxLongReached:lp.length<Number(maxPositions.LONG),
   notMaxShortReached:sp.length<Number(maxPositions.SHORT)
  };

  /* RESET */
specs.forEach(s=>{
  if(
    positionMode[s.type]==="MANY" &&
    s.reset.length &&
    evalGroup(s.reset,i,{})===true
  ){
    ready[s.type]=true;
  }
});

/* READY CLOSE: arm хийх / арилгах */
specs.forEach(s=>{
  if(!s.rc.length)return;

  const list=positions[s.type];

  if(!list.length){
    armed[s.type]=false;
    return;
  }

  if(armed[s.type])return;

  const last=list[list.length-1];

  const ctx={
    ...dyn,
    longLimit:s.type==="LONG"?last.limit:null,
    shortLimit:s.type==="SHORT"?last.limit:null
  };

  if(evalGroup(s.rc,i,ctx)===true){
    armed[s.type]=true;
  }
});

/* EXIT */
specs.forEach(s=>{
  for(let k=positions[s.type].length-1;k>=0;k--){

    const p=positions[s.type][k];

    const pnlNow=
      s.type==="LONG"
        ? bid-p.entryPrice
        : p.entryPrice-ask;

    p.peak=Math.max(p.peak,pnlNow);

    const ctx={
      ...dyn,
      armed:armed[s.type],
      longLimit:s.type==="LONG"?p.limit:null,
      shortLimit:s.type==="SHORT"?p.limit:null
    };

    if(evalGroup(s.exit,i,ctx)===true){
      closePosition(s.type,k,c);
    }
  }

  if(!positions[s.type].length){
    armed[s.type]=false;
  }
});

/* OPEN */
specs.forEach(s=>{
   const t=s.type,mode=positionMode[t];
   if(mode==="SINGLE"){if(positions[t].length>0)return}
   else if(mode==="MANY"){
    if(!ready[t]||positions[t].length>=Number(maxPositions[t]))return;
   }else return;
   const limits = getOpenLimits(i);

   const ctx = {
    ...dyn,
       longCount: positions.LONG.length,
       shortCount: positions.SHORT.length,
       longLimit: limits.longLimit,
       shortLimit: limits.shortLimit
   };

   if(evalGroup(s.open,i,ctx)===true){
       openPosition(t,c,i);
   }
  });

/* ACCOUNT */
   {
      const bd = Number(c.bid);
      const ak = Number(c.ask);

      const fl =
        (
          sum(positions.LONG.map(p => bd - p.entryPrice)) +
          sum(positions.SHORT.map(p => p.entryPrice - ak))
        ) * A.k;

      const nl = positions.LONG.length;
      const ns = positions.SHORT.length;

      const lots = A.hedged
        ? Math.max(nl, ns)
        : nl + ns;

      const margin = lots * A.k * bd / A.lev;
      const eq = A.bal + acc.closed + fl;

      acc.bars++;
      acc.lastEq = eq;
      acc.peak = Math.max(acc.peak, eq);
      acc.maxDD = Math.min(acc.maxDD, eq - acc.peak);

      if(eq < acc.peak){
         acc.ddBars++;
      }

      acc.minEq = Math.min(acc.minEq, eq);
      acc.minFloat = Math.min(acc.minFloat, fl);
      acc.maxPos = Math.max(acc.maxPos, nl + ns);

      if(margin > 0){
         const ml = eq / margin * 100;

         if(acc.minML === null || ml < acc.minML){
            acc.minML = ml;
         }

         acc.need = Math.max(
            acc.need,
            A.so / 100 * margin - acc.closed - fl
         );

         if(acc.soIndex === null && ml <= A.so){
            acc.soIndex = i;
            acc.soTime = time(c.open_time);
         }
      }
   }
 });

/* =====================================================
     FINAL STATS
  ===================================================== */

  const s = stats(
    trades,
    positions,
    events.length,
    activeCandles
  );

  s.acc = acc;
  s.A = A;

  render(
    count,
    trades,
    events,
    s
  );
}

/* =========================================================
   STATS
========================================================= */

function stats(trades, pos, totalEvents, activeCandles){

   const p = trades.map(x => Number(x.pnl));

   const wins = p.filter(x => x > 0);
   const losses = p.filter(x => x < 0);

   const net = sum(p);
   const gp = sum(wins);
   const gl = sum(losses);

   let bal = 0;
   let peak = 0;
   let dd = 0;

   trades.forEach(t => {
      bal += t.pnl;
      peak = Math.max(peak, bal);
      dd = Math.min(dd, bal - peak);
   });

   const data =
      activeCandles.length
         ? activeCandles
         : candles;

   const last =
      data.length
         ? data[data.length - 1]
         : null;

   const openPositions = [];

   if(last){

      ["LONG", "SHORT"].forEach(type => {

         pos[type].forEach(q => {

            const cp = Number(
               type === "LONG"
                  ? last.bid
                  : last.ask
            );

            if(!fin(cp)) return;

            openPositions.push({
               type,
               entryTime: q.entryTime,
               entryPrice: q.entryPrice,
               limit: q.limit,
               currentPrice: cp,

               pnl:
                  type === "LONG"
                     ? cp - q.entryPrice
                     : q.entryPrice - cp
            });

         });

      });

   }

   return {

      netPnl: net,

      grossProfit: gp,

      grossLoss: gl,

      wins: wins.length,

      losses: losses.length,

      winRate:
         p.length
            ? wins.length / p.length * 100
            : 0,

      profitFactor:
         gl < 0
            ? gp / Math.abs(gl)
            : gp > 0
               ? Infinity
               : 0,

      averageWin:
         wins.length
            ? gp / wins.length
            : 0,

      averageLoss:
         losses.length
            ? gl / losses.length
            : 0,

      largestWin:
         wins.length
            ? Math.max(...wins)
            : 0,

      largestLoss:
         losses.length
            ? Math.min(...losses)
            : 0,

      maxDrawdown: dd,

      finalBalance: bal,

      openLong: pos.LONG.length,

      openShort: pos.SHORT.length,

      totalEvents,

      openPositions

   };
}

/* ===== RENDER ===== */

const cardsHTML=a=>a.map(([l,v])=>`<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");
const emptyHTML=t=>`<div style="padding:15px;color:#9ca3af">${t}</div>`;
const headHTML=a=>`<div class="completed header">${a.map(x=>`<div>${x}</div>`).join("")}</div>`;
const pClass=v=>v>=0?"pnlp":"pnln";
const totalHTML=(n,label,v)=>`<div class="completed total-row"><div style="color:#facc15;font-weight:bold">TOTAL</div><div>-</div><div>-</div><div>-</div><div style="color:#9ca3af">${n} ${label}</div><div class="${pClass(v)}">${pnl(v)}</div></div>`;

function render(count,trades,events,s){
 window.backtestEvents=events||[];
 window.backtestTrades=trades||[];

 $("results").innerHTML=cardsHTML([
  ["COMPLETED TRADES",trades.length],
  ["LONG TRADES",count.LONG.trades],["SHORT TRADES",count.SHORT.trades],
  ["LONG OPEN",count.LONG.open],["LONG CLOSE",count.LONG.close],
  ["SHORT OPEN",count.SHORT.open],["SHORT CLOSE",count.SHORT.close],
  ["TOTAL EVENTS",s.totalEvents]
 ]);

 const money=["netPnl","grossProfit","grossLoss","averageWin","averageLoss","largestWin","largestLoss","maxDrawdown","finalBalance"];
 $("stats").innerHTML=cardsHTML([
  ["NET P/L","netPnl"],["GROSS PROFIT","grossProfit"],["GROSS LOSS","grossLoss"],
  ["WINNING TRADES","wins"],["LOSING TRADES","losses"],["WIN RATE","winRate"],
  ["PROFIT FACTOR","profitFactor"],["AVERAGE WIN","averageWin"],["AVERAGE LOSS","averageLoss"],
  ["LARGEST WIN","largestWin"],["LARGEST LOSS","largestLoss"],["MAX DRAWDOWN","maxDrawdown"],
  ["FINAL BALANCE","finalBalance"],["OPEN LONG","openLong"],["OPEN SHORT","openShort"],
  ["TOTAL EVENTS","totalEvents"]
 ].map(([label,key])=>{
  let v=s[key];
  if(key==="winRate")v=v.toFixed(2)+"%";
  else if(key==="profitFactor")v=fin(v)?v.toFixed(2):"∞";
  else if(money.includes(key))v=pnl(v);
  return[label,v];
 }));

 $("tradeLog").innerHTML=
  `<div class="trade header"><div>TIME (MT5)</div><div>PRICE</div><div>LIMIT</div><div>ACTION</div></div>`+
  (events.length?events.map(e=>`<div class="trade"><div class="time">${e.time}</div><div class="price">${price(e.price)}</div><div class="price">${price(e.limit)}</div><div class="${e.action.startsWith("LONG")?"green":"red"}">${e.action}</div></div>`).join(""):emptyHTML("No trade events"));

 const op=s.openPositions,openTotal=sum(op.map(t=>Number(t.pnl||0)));
 $("openedLog").innerHTML=
  headHTML(["TYPE","ENTRY TIME","ENTRY PRICE","LIMIT","CURRENT PRICE","FLOATING P/L"])+
  (op.length?op.map(t=>`<div class="completed"><div>${t.type}</div><div class="time">${t.entryTime}</div><div>${price(t.entryPrice)}</div><div>${price(t.limit)}</div><div>${price(t.currentPrice)}</div><div class="${pClass(t.pnl)}">${pnl(t.pnl)}</div></div>`).join(""):emptyHTML("No opened positions"))+
  (op.length?totalHTML(op.length,"POSITIONS",openTotal):"");

 const doneTotal=sum(trades.map(t=>Number(t.pnl||0)));
 $("completedLog").innerHTML=
  headHTML(["TYPE","ENTRY TIME","ENTRY PRICE","EXIT TIME","EXIT PRICE","P/L"])+
  (trades.length?trades.map(t=>`<div class="completed"><div>${t.type}</div><div class="time">${t.entryTime}</div><div>${price(t.entryPrice)}</div><div class="time">${t.exitTime}</div><div>${price(t.exitPrice)}</div><div class="${pClass(t.pnl)}">${pnl(t.pnl)}</div></div>`).join(""):emptyHTML("No completed trades"))+
  (trades.length?totalHTML(trades.length,"TRADES",doneTotal):"");

 const a=s.acc,A=s.A,$$=v=>(v>=0?"+":"")+v.toFixed(2);
 $("accStats").innerHTML=cardsHTML([
  ["START BALANCE","$"+A.bal.toFixed(2)],
  ["FINAL EQUITY","$"+a.lastEq.toFixed(2)],
  ["CLOSED P/L $",$$(a.closed)],
  ["MAX DRAWDOWN (EQUITY) $",$$(a.maxDD)],
  ["MAX DD % OF BALANCE",(a.maxDD/A.bal*100).toFixed(2)+"%"],
  ["MIN EQUITY","$"+a.minEq.toFixed(2)],
  ["MAX FLOATING LOSS $",$$(a.minFloat)],
  ["MAX OPEN POSITIONS",a.maxPos],
  ["MIN MARGIN LEVEL",a.minML===null?"-":a.minML.toFixed(0)+"%"],
  ["MIN ACCOUNT NEEDED","$"+Math.max(0,a.need).toFixed(2)],
  ["TIME IN DRAWDOWN",(a.bars?a.ddBars/a.bars*100:0).toFixed(0)+"%"],
  ["STOP-OUT",a.soIndex===null?"NO":"YES"]
 ]);
  $("accNote").textContent=a.soIndex===null
  ?`✅ Stop-out (${A.so}%) болоогүй. LOT ${A.lot}, 1:${A.lev}.`
  :`❌ ACCOUNT BLOWN: ${a.soTime} (свеч #${a.soIndex}) үед margin level ${A.so}%-иас доош орсон. Хамгийн багадаа $${Math.max(0,a.need).toFixed(2)} данс хэрэгтэй байсан.`;
}

/* ===== DATA LOADING ===== */

async function loadInitialData(){
    const status = $("status");

    status.textContent = "Loading GOLD data...";

    try {
        const response = await fetch("/api/gold");

        if(!response.ok){
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();

        if(payload.error){
            throw new Error(payload.error);
        }

        if(!Array.isArray(payload.candles) || !payload.candles.length){
            throw new Error("No GOLD candle data returned.");
        }

        window.candles = payload.candles;

        status.textContent =
            `✅ GOLD data loaded — ${window.candles.length} candles`;

        $("dataInfo").textContent =
            `13 columns | ${window.candles.length} candles`;

        applyIndicators();

    }catch(error){
        console.error("INITIAL DATA LOAD ERROR:", error);

        status.textContent =
            "❌ Failed to load GOLD data: " + error.message;
    }
}

const infoText=()=>`13 columns | ${getCandles().length} candles`;

$("run").onclick=()=>{
 const btn=$("run");
 if(!getCandles().length)
    return alert("No GOLD candle data loaded.");
 const range=getBacktestRange();
 if(range.count<=0)return alert("Selected range has no candles.");

 btn.disabled=true;
 btn.textContent="RUNNING BACKTEST...";
 $("backtestStatus").textContent="Running hedge backtest...";
 try{
  runBacktest();
  const rangeText=!$("addRange").checked?`ALL ${range.count} CANDLES`
   :range.mode==="LAST"?`LAST ${range.days} DAY${range.days>1?"S":""} — ${range.count} CANDLES`
   :`DAY ${range.days} — ${range.count} CANDLES`;
  $("backtestStatus").textContent=`✅ BACKTEST COMPLETED — ${rangeText}`;
 }catch(e){
  console.error(e);
  $("backtestStatus").textContent="❌ BACKTEST ERROR: "+e.message;
  alert("BACKTEST ERROR:\n"+e.message);
 }finally{
  btn.disabled=false;
  btn.textContent="RUN HEDGE BACKTEST";
 }
};

$("applyIndicators").onclick=applyIndicators;
$("addRange").onchange=$("rangeMode").onchange=$("rangeDay").onchange=updateRangeUI;
updateRangeUI();

</script>

<script src="/JS/condition.js"></script>
<script src="/JS/strategy.js"></script>

<script>
window.addEventListener("DOMContentLoaded", async () => {

    try {
        buildGroups();

        loadStrategyJSON(DEFAULT_TEST_STRATEGY);

        await loadInitialData();

    } catch (error) {
        console.error("INITIALIZATION ERROR:", error);

        const status = document.getElementById("status");

        if (status) {
            status.textContent =
                "❌ Initialization failed: " + error.message;
        }
    }

});

</script>

</body>
</html>"""

@app.route("/")
def index():
    return render_template_string(HTML)

# JS болон бусад static файлуудыг татах зөв route
@app.route("/JS/<path:filename>")
def chart_js(filename):
    return send_from_directory(JS_DIR, filename)

@app.route("/api/gold")
def gold_api():
    try:
        limit = request.args.get("limit")
        candles = load_backtest_data(int(limit) if limit else None)
        return jsonify({
            "symbol": "GOLD",
            "timeframe": "1m",
            "count": len(candles),
            "candles": candles
        })
    except Exception as e:
        print("GOLD API ERROR:", repr(e))
        return jsonify({"error": str(e)}), 500

# ============================================================
# HEALTH CHECK
# ============================================================

@app.route("/health")
def health():

    return jsonify({
        "status": "ok",
        "service": "gold-backtest"
    })


# ============================================================
# START
# ============================================================

if __name__ == "__main__":

    print("=" * 60)
    print("GOLD HEDGE BACKTEST SERVER")
    print("=" * 60)
    print("HTML  : http://127.0.0.1:5000/")
    print("API   : http://127.0.0.1:5000/api/gold")
    print("HEALTH: http://127.0.0.1:5000/health")
    print("=" * 60)

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )
