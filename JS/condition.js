"use strict";

const $ = id => document.getElementById(id);

// ==================== 1. RAILWAY DATAS & CANDLES ====================
// Зөвхөн window.candles л ашиглана, өөр local candles байхгүй!
window.candles = window.candles || [];

async function initMarketData() {
    const status = $("status") || document.getElementById("status");
    if(status) status.textContent = "Loading GOLD data & Indicators from Railway...";

    try {
        // 1. Үндсэн Gold лаа болон базовый массив татах
        const res = await fetch("https://web-production-c3082.up.railway.app/api/gold");
        const data = await res.json();
        
        if (!data.candles || !Array.isArray(data.candles)) {
            throw new Error("No candles found in response");
        }

        // 2. RSI болон MACD дэвшилтэт тайлангуудыг серверээс зэрэг татах
        const [rsiRes, macdRes] = await Promise.all([
            fetch("https://web-production-c3082.up.railway.app/rsi/GOLD").then(r => r.json()).catch(() => ({})),
            fetch("https://web-production-c3082.up.railway.app/macd/GOLD").then(r => r.json()).catch(() => ({}))
        ]);

        console.log("RSI Extended Data:", rsiRes);
        console.log("MACD Extended Data:", macdRes);

        // 3. Лаа тус бүр дээр серверээс ирсэн дэвшилтэт утгуудыг индексээр нь тааруулж шингээх
        window.candles = data.candles.map((c, index) => {
            // Хэрэв массив хэлбэрээр ирдэг бол индексээр нь, үгүй бол шууд утгаар нь авна
            const getArrVal = (arr) => Array.isArray(arr) ? (arr[index] ?? null) : (arr ?? null);

            return {
                ...c,
                // RSI нэмэлт статусууд
                rsi_trend: getArrVal(rsiRes.trend),
                rsi_last_status: getArrVal(rsiRes.last_status),
                rsi_avg: getArrVal(rsiRes.average_status),
                
                // MACD нэмэлт статусууд
                macd_trend: getArrVal(macdRes.trend),
                
                // Бодит Ask/Bid (хиймэл spread хасахгүй)
                bid: Number(c.close),
                ask: Number(c.close)
            };
        });

        console.log("✅ Fully enriched candles loaded:", window.candles.length);
        if(status) status.textContent = `✅ GOLD data & Indicators loaded — ${window.candles.length} candles`;

        if (typeof buildGroups === "function") {
            buildGroups();
        }
        if (typeof applyIndicators === "function") {
            applyIndicators();
        }

    } catch (e) {
        console.error("❌ Failed to load candles or indicators:", e);
        if(status) status.textContent = "❌ Failed to load data: " + e.message;
    }
}

const positionMode = {
    LONG: "SINGLE",
    SHORT: "SINGLE"
};

const maxPositions = {
    LONG: 1,
    SHORT: 1
};

const indicatorSettings = {
    rsiPeriod: 7,
    rsiSource: "close",
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
};

const groups={
 longOpen:[],longReset:[],longExit:[],longReadyClose:[],
 shortOpen:[],shortReset:[],shortExit:[],shortReadyClose:[]
};

const CFG={
 longOpen:["LONG OPEN CONDITION","LONG OPEN","+ ADD CONDITION"],
 longReset:["LONG RESET CONDITION","LONG RESET","+ ADD RESET CONDITION"],
 longExit:["LONG EXIT CONDITION","LONG EXIT","+ ADD EXIT CONDITION"],
 shortOpen:["SHORT OPEN CONDITION","SHORT OPEN","+ ADD CONDITION"],
 shortReset:["SHORT RESET CONDITION","SHORT RESET","+ ADD RESET CONDITION"],
 shortExit:["SHORT EXIT CONDITION","SHORT EXIT","+ ADD EXIT CONDITION"],
 longReadyClose:["LONG READY CLOSE CONDITION","LONG READY CLOSE","+ ADD READY CLOSE CONDITION"],
 shortReadyClose:["SHORT READY CLOSE CONDITION","SHORT READY CLOSE","+ ADD READY CLOSE CONDITION"],
};

/* CANDLE VALUES */
const fields=[
 ["open_time","OPEN_TIME"],["open","OPEN"],["high","HIGH"],["low","LOW"],
 ["close","CLOSE"],["volume","VOLUME"],["rsi","RSI"],["macd_line","MACD_LINE"],
 ["macd_signal","MACD_SIGNAL"],["macd_histogram","MACD_HISTOGRAM"],["bid","BID"],["ask","ASK"]
];

const values=[];
fields.forEach(([field,label])=>{
 [0,-1,-2,-3,-4,-5].forEach((offset,i)=>values.push({name:label+i,field,offset}));
});

/* DYNAMIC VALUES */
[
 "LONG_COUNT","SHORT_COUNT","MAX_LONG_REACHED","MAX_SHORT_REACHED",
 "NOT_MAX_LONG_REACHED","NOT_MAX_SHORT_REACHED","LONG_PNL","SHORT_PNL","TOTAL_FLOATING_PNL",
 "LAST_LONG_PNL","LAST_SHORT_PNL","MAX_LONG_PNL","MAX_SHORT_PNL"
].forEach(name=>values.push({name,dynamic:true}));

/* PRESETS: [label,left,op,rightType,right] or {label,conditions} */
const P=(l,o,t,r)=>[`${l} ${o} ${t==="number"?"NUMBER":r}`,l,o,t,r];
const V=(l,o,r)=>P(l,o,"value",r);
const NUM=(l,o)=>P(l,o,"number","");
const rsi2=(a,b,n)=>({
 label:`RSI1 ${a} ${n} AND RSI2 ${b} ${n}`,
 conditions:[["RSI1",a,"number",String(n)],["RSI2",b,"number",String(n),"AND"]]
});

const PRESETS=[
 V("OPEN0",">","OPEN1"),V("OPEN0","<","OPEN1"),

 P("OPEN0",">","long_limit","LONG_LIMIT"),P("OPEN0","<","long_limit","LONG_LIMIT"),
 P("OPEN0",">","short_limit","SHORT_LIMIT"),P("OPEN0","<","short_limit","SHORT_LIMIT"),

 NUM("RSI1",">"),NUM("RSI1","<"),V("RSI1",">","RSI2"),V("RSI1","<","RSI2"),
 rsi2(">","<",30),rsi2("<",">",30),rsi2(">","<",70),rsi2("<",">",70),

 V("MACD_LINE1",">","MACD_SIGNAL1"),V("MACD_LINE1","<","MACD_SIGNAL1"),
 V("MACD_HISTOGRAM1",">","MACD_HISTOGRAM2"),V("MACD_HISTOGRAM1","<","MACD_HISTOGRAM2"),
 NUM("MACD_HISTOGRAM1",">"),NUM("MACD_HISTOGRAM1","<"),
 NUM("MACD_LINE1",">"),NUM("MACD_LINE1","<"),
    
 V("VOLUME0",">","VOLUME1"),V("VOLUME0","<","VOLUME1")
];

/* CONDITION OBJECT */
const condition=()=>({
 id:Date.now()+Math.random(),logic:"AND",left:"",operator:">",right:"",rightType:"value",readyClose:false
});

const autoJSON=()=>{if(typeof autoStrategyJSON==="function")autoStrategyJSON()};

/* PRESET ADD */
function addPreset(type,p){
 if(!groups[type])return console.error("Unknown condition group:",type);

 if(p.conditions){
  p.conditions.forEach((x,i)=>{
   const c=condition();
   Object.assign(c,{left:x[0],operator:x[1],rightType:x[2],right:x[3]});
   if(i)c.logic=x[4]||"AND";
   groups[type].push(c);
  });
 }else{
  const c=condition();
  Object.assign(c,{left:p[1],operator:p[2],rightType:p[3],right:p[4]});
  groups[type].push(c);
 }

 renderGroup(type);
 preview(type);
}

/* ADVANCED MENU */
const closeMenus=()=>document.querySelectorAll(".advanced-menu").forEach(x=>x.classList.remove("show"));

function toggleAdvanced(type){
 const m=$(type+"AdvancedMenu"),open=m.classList.contains("show");
 closeMenus();
 if(!open)m.classList.add("show");
}

document.addEventListener("click",e=>{
 if(!e.target.closest(".advanced-wrap"))closeMenus();
});

function buildAdvancedMenu(type){
 const m=$(type+"AdvancedMenu");
 m.innerHTML=PRESETS.map((p,i)=>
  `<button type="button" class="advanced-item" data-i="${i}">${p.conditions?p.label:p[0]}</button>`
 ).join("");
 m.querySelectorAll(".advanced-item").forEach(b=>{
  b.onclick=()=>{addPreset(type,PRESETS[+b.dataset.i]);m.classList.remove("show")};
 });
}

/* VALUE LOOKUP */
const def=name=>values.find(x=>x.name===name);
const N0=v=>Number(v??0);

const dynGet={
 LONG_COUNT:c=>N0(c.longCount),
 SHORT_COUNT:c=>N0(c.shortCount),
 LONG_PNL:c=>N0(c.longPnl),
 SHORT_PNL:c=>N0(c.shortPnl),
 TOTAL_FLOATING_PNL:c=>N0(c.totalFloatingPnl),
 LAST_LONG_PNL:c=>c.lastLongPnl??null,
 LAST_SHORT_PNL:c=>c.lastShortPnl??null,
 MAX_LONG_PNL:c=>c.maxLongPnl??null,
 MAX_SHORT_PNL:c=>c.maxShortPnl??null,
 MAX_LONG_REACHED:c=>N0(c.longCount)>=Number(maxPositions.LONG),
 MAX_SHORT_REACHED:c=>N0(c.shortCount)>=Number(maxPositions.SHORT),
 NOT_MAX_LONG_REACHED:c=>N0(c.longCount)<Number(maxPositions.LONG),
 NOT_MAX_SHORT_REACHED:c=>N0(c.shortCount)<Number(maxPositions.SHORT),
};

function val(name, i, ctx = {}) {
    if (dynGet[name]) {
        return dynGet[name](ctx);
    }

    const d = def(name);

    if (!d) {
        return null;
    }

    const data = ctx.data || candles;

    const n = i + d.offset;

    if (n < 0 || n >= data.length) {
        return null;
    }

    const x = Number(data[n][d.field]);

    return Number.isFinite(x) ? x : null;
}

/* COMPARISON */
function compare(a,o,b){
 if(a===null||b===null)return null;
 return{">":a>b,"<":a<b,">=":a>=b,"<=":a<=b,"==":a===b,"!=":a!==b}[o]??null;
}

function evalCondition(c,i,ctx={}){
    if(!c.left)return null;

    if(c.readyClose && ctx.armed===false)
        return false;

    if(
        (c.rightType==="value" || c.rightType==="number") &&
        !c.right
    )
        return null;

    const a = val(c.left,i,ctx);

    const b =
        c.rightType === "number"
            ? Number(c.right)
        : c.rightType === "long_limit"
            ? Number(ctx.longLimit)
        : c.rightType === "short_limit"
            ? Number(ctx.shortLimit)
        : val(c.right,i,ctx);

    return Number.isFinite(a) &&
           Number.isFinite(b)
        ? compare(a,c.operator,b)
        : null;
}

/* GROUP */
function evalGroup(list,i,ctx={}){
 if(!list.length)return false;
 let r=null;
 for(let n=0;n<list.length;n++){
  const x=evalCondition(list[n],i,ctx);
  if(x===null)return null;
  r=n?(list[n].logic==="AND"?r&&x:r||x):x;
 }
 return r;
}

/* UI HELPERS */
function makeSelect(current,placeholder,fn){
 const s=document.createElement("select");
 s.innerHTML=`<option value="">${placeholder}</option>`+
  values.map(x=>`<option value="${x.name}">${x.name}</option>`).join("");
 s.value=current;
 s.onchange=()=>fn(s.value);
 return s;
}

function plainSelect(html,value,fn,cls){
 const s=document.createElement("select");
 if(cls)s.className=cls;
 s.innerHTML=html;
 s.value=value;
 s.onchange=()=>fn(s.value);
 return s;
}

const OPS=[">","<",">=","<=","==","!="].map(o=>`<option value='${o}'>${o.replace(/</g,"&lt;")}</option>`).join("");

/* CONDITION UI */
function renderGroup(type){
 const box=$(type+"Box");
 if(!box)return console.warn(`renderGroup: #${type}Box does not exist yet`);

 box.innerHTML="";
 box.className="condition-box";

 groups[type].forEach((c,i)=>{
  const r=document.createElement("div");
  r.className="condition-row";

  if(i)r.appendChild(plainSelect(
   "<option value='AND'>AND</option><option value='OR'>OR</option>",
   c.logic||"AND",v=>{c.logic=v;preview(type)},"condition-logic"
  ));

  r.appendChild(makeSelect(c.left,"LEFT VALUE",v=>{c.left=v;preview(type)}));

  r.appendChild(plainSelect(OPS,c.operator||">",v=>{c.operator=v;preview(type)}));

  r.appendChild(plainSelect(
   '<option value="value">VALUE</option><option value="number">NUMBER</option>'+
   '<option value="long_limit">LONG LIMIT</option><option value="short_limit">SHORT LIMIT</option>',
   c.rightType||"value",
   v=>{
    c.rightType=v;
    c.right=v==="long_limit"?"LONG_LIMIT":v==="short_limit"?"SHORT_LIMIT":"";
    renderGroup(type);preview(type);
   } 
  ));

  if(c.rightType==="value"){
   r.appendChild(makeSelect(c.right,"RIGHT VALUE",v=>{c.right=v;preview(type)}));
  }else{
   const inp=document.createElement("input");
   if(c.rightType==="long_limit"||c.rightType==="short_limit"){
    inp.type="text";
    inp.value=c.right||(c.rightType==="long_limit"?"LONG LIMIT":"SHORT LIMIT");
    inp.disabled=true;
   }else{
    inp.type="number";
    inp.step="any";
    inp.placeholder="NUMBER";
    inp.value=c.right||"";
    inp.oninput=()=>{c.right=inp.value;preview(type)};
   }
   r.appendChild(inp);
  }

  if(/Exit$/.test(type)){
   r.classList.add("has-ready");
   r.appendChild(plainSelect(
    '<option value="0">NO READY</option><option value="1">WITH READY</option>',
    c.readyClose?"1":"0",
    v=>{c.readyClose=v==="1";preview(type)}
   ));
  }

  const del=document.createElement("button");
  del.textContent="✕";
  del.title="Delete condition";
  del.onclick=()=>{
   groups[type]=groups[type].filter(x=>x.id!==c.id);
   renderGroup(type);
   preview(type);
  };
  r.appendChild(del);

  box.appendChild(r);
 });
}

/* PREVIEW TEXT */
function text(list){
 if(!list.length)return "No conditions";
 return list.map((c,i)=>
  (i?c.logic+" ":"")+`${c.left||"LEFT"} ${c.operator} ${c.right||(c.rightType==="number"?"NUMBER":"RIGHT")}`+(c.readyClose?" [READY]":"")
 ).join(" ");
}

function preview(type){
 const el=$(type+"Preview");
 if(el)el.textContent=text(groups[type]);
 autoJSON();
}

function add(type){
 groups[type].push(condition());
 renderGroup(type);
 preview(type);
}

/* RESET GROUP VISIBILITY */
function updateModeVisibility(side){
 const resetType=side==="LONG"?"longReset":"shortReset";
 const box=$(resetType+"Box");
 const section=box&&box.closest(".section");
 if(!section)return;

 if(positionMode[side]==="MANY"){
  section.style.display="";
 }else{
  section.style.display="none";
  groups[resetType]=[];
  renderGroup(resetType);
  preview(resetType);
 }
}

/* BUILD ALL GROUPS */
function buildGroups(){
 const root=$("groups");
 root.innerHTML="";

 [
  ["longOpen","LONG OPEN CONDITION","LONG"],
  ["longReset","LONG RESET CONDITION","LONG"],
  ["longExit","LONG EXIT CONDITION","LONG"],
  ["longReadyClose","LONG READY CLOSE CONDITION","LONG"],
  ["shortOpen","SHORT OPEN CONDITION","SHORT"],
  ["shortReset","SHORT RESET CONDITION","SHORT"],
  ["shortReadyClose","SHORT READY CLOSE CONDITION","SHORT"],
  ["shortExit","SHORT EXIT CONDITION","SHORT"]
 ].forEach(([type,title,side])=>{
  const key=side.toLowerCase();
  const isOpen=type==="longOpen"||type==="shortOpen";

  const modeHtml=isOpen?`
   <div class="row"><div class="position-mode-row">
    <span class="position-mode-label">${side} POSITION MODE</span>
    <label class="position-option"><input type="radio" name="${key}PositionMode" value="SINGLE" checked> SINGLE POS</label>
    <label class="position-option"><input type="radio" name="${key}PositionMode" value="MANY"> MANY POS</label>
    <span id="${key}MaxPosWrap" class="max-pos-wrap" style="display:none">
     <label>MAX POS</label>
     <input id="${key}MaxPos" type="number" min="1" step="1" value="10">
    </span>
   </div></div>`:"";

  const s=document.createElement("div");
  s.className="section";
  s.innerHTML=`
   <div class="section-title">${title}</div>
   ${modeHtml}
   <div id="${type}Box"></div>
   <div class="advanced-wrap">
    <button type="button" id="${type}Advanced">ADVANCED CONDITIONS ▼</button>
    <div id="${type}AdvancedMenu" class="advanced-menu"></div>
   </div>
   <button type="button" id="${type}Add">${CFG[type][2]}</button>
   <button type="button" id="${type}Prev">PREVIEW</button>
   <div id="${type}Preview" class="preview ${/Exit|Reset|ReadyClose/.test(type)?"exit":""}">No conditions</div>`;
  root.appendChild(s);

  if(isOpen){
   document.querySelectorAll(`input[name="${key}PositionMode"]`).forEach(radio=>{
    radio.onchange=()=>{
     positionMode[side]=radio.value;

     const wrap=$(key+"MaxPosWrap"),input=$(key+"MaxPos");
     if(wrap)wrap.style.display=radio.value==="MANY"?"inline-flex":"none";

     if(input){
      const setMax=()=>{
       const n=parseInt(input.value,10);
       if(Number.isInteger(n)&&n>=1)maxPositions[side]=n;
      };
      input.oninput=setMax;
      setMax();
     }

     updateModeVisibility(side);
    };
   });
  }

  $(type+"Advanced").onclick=()=>toggleAdvanced(type);
  $(type+"Add").onclick=()=>add(type);
  $(type+"Prev").onclick=()=>preview(type);
  buildAdvancedMenu(type);
 });

 updateModeVisibility("LONG");
 updateModeVisibility("SHORT");
}


initMarketData();
buildGroups(); // Комментоо арилгавал UI формоороо зурагдаад гарна
