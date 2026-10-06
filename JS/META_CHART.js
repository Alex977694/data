(function(){
 const c=document.getElementById("metaChartContainer");
 if(!c)return console.error("[META CHART] #metaChartContainer not found");
 c.innerHTML=`<div id="chart-wrapper" style="position:relative;width:100%;height:100%;min-height:600px;background:#000;overflow:hidden;"><canvas id="chart" style="display:block;width:100%;height:100%;cursor:crosshair;"></canvas></div>`;
})();

window.dispatchChartUpdate=function(){};
window.macdMode='normal';   // 'normal' | 'max' | 'min'
window.rsiMode='normal';
window.atrMode='normal';

function formatPrice(p){
 p=Number(p);
 if(!Number.isFinite(p))return "-";
 if(p>=100)return p.toFixed(2);
 if(p>=1)return p.toFixed(4);
 if(p>=0.001)return p.toFixed(6);
 return p.toPrecision(4);
}

const pad2=n=>String(n).padStart(2,"0");
const finNum=v=>Number.isFinite(Number(v))?Number(v):null;

function timeLabel(ts,interval){
 const d=new Date(ts);
 if(/[dwM]$/.test(interval))
  return d.toLocaleDateString("en-GB",{timeZone:"UTC",year:"numeric",month:"2-digit",day:"2-digit"});
 return pad2(d.getUTCHours())+":"+pad2(d.getUTCMinutes());
}

/* "label value  label value" мөр зурах */
function drawLabels(ctx,x,y,items){
 ctx.font="11px Arial";
 ctx.textBaseline="top";
 items.forEach(([label,val,color])=>{
  ctx.fillStyle="#888";
  ctx.fillText(label,x,y);
  x+=ctx.measureText(label).width;
  ctx.fillStyle=color||"#fff";
  ctx.fillText(val+"  ",x,y);
  x+=ctx.measureText(val+"  ").width;
 });
}

/* mouse-ийн доорх candle-ийн index (хэрэв chart дотор биш бол сүүлийн candle) */
function activeIndex(m,padding,chartWidth,candleWidth,len){
 if(m&&m.x!==null&&m.x>padding&&m.x<padding+chartWidth){
  const i=Math.floor((m.x-padding)/candleWidth);
  if(i>=0&&i<len)return i;
 }
 return len-1;
}

document.addEventListener("DOMContentLoaded",()=>{
 const canvas=document.getElementById("chart");
 if(!canvas)return;
 const ctx=canvas.getContext("2d");

 const marketEl=document.getElementById("market");
 const intervalEl=document.getElementById("interval");
 const coinEl=document.getElementById("coin");

 let symbol="GOLD",interval="1m";

 window.allData=[];
 window.rsiArrayData = [];
 window.macdArrayData = [];
 window.signalArrayData = [];
 window.histArrayData = [];
 window.atrArrayData = [];
 window.backtestEvents=[];

 let visibleCount=500,offset=0;
 const minVisible=20,maxVisible=10000;
 const mouse={x:null,y:null};
 let dragging=false,lastX=0;
 let priceScale=1,priceOffset=0,draggingPrice=false,lastY=0;
 let lastPriceRange=0,lastChartHeight=0;

 const PAD=40,PSW=80;

 function resize(){
  const p=canvas.parentElement;
  canvas.width=p?p.clientWidth:window.innerWidth;
  canvas.height=p?p.clientHeight:window.innerHeight;
  draw();
 }
 window.addEventListener("resize",resize);
 setTimeout(resize,100);

 function draw(){
  if(!window.allData||!window.allData.length)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const padding=PAD,priceScaleWidth=PSW,timeScaleHeight=30;
  const chartHeight=canvas.height-padding*2-timeScaleHeight;
  lastChartHeight=chartHeight;
  const chartWidth=canvas.width-padding*2-priceScaleWidth;

  const end=window.allData.length-offset;
  const start=Math.max(0,end-visibleCount);
  window._chartStartIndex=start;
  const data=window.allData.slice(start,end);
  if(!data.length)return;

  const candleWidth=chartWidth/data.length;

  let maxPrice=-Infinity,minPrice=Infinity;
  data.forEach(d=>{if(d[2]>maxPrice)maxPrice=d[2];if(d[3]<minPrice)minPrice=d[3]});

  if(maxPrice===minPrice){
   const pp=maxPrice>1?maxPrice*0.001:0.001;
   maxPrice+=pp;minPrice-=pp;
  }
  const buf=(maxPrice-minPrice)*0.05;
  maxPrice+=buf;minPrice-=buf;

  if(priceScale!==1){
   const mid=(maxPrice+minPrice)/2,half=(maxPrice-minPrice)/2*priceScale;
   maxPrice=mid+half;minPrice=mid-half;
  }
  lastPriceRange=maxPrice-minPrice;
  maxPrice+=priceOffset;minPrice+=priceOffset;

  /* Panel-ийн өндрийн харьцаа */
    /* Panel-ийн өндрийн харьцаа */
  const R={main:.52,macd:.16,rsi:.16,atr:.16};
  [["macd",window.macdMode],["rsi",window.rsiMode],["atr",window.atrMode]].forEach(([k,m])=>{
   if(m==='max'){Object.assign(R,{main:.2,macd:.2,rsi:.2,atr:.2});R[k]=.4}
   else if(m==='min'){Object.assign(R,{main:.55,macd:.2,rsi:.2,atr:.2});R[k]=.05}
  });
  const mainRatio=R.main,macdRatio=R.macd,rsiRatio=R.rsi,atrRatio=R.atr;

  const mainChartHeight=chartHeight*mainRatio;
  const priceToY=p=>padding+(maxPrice-p)/(maxPrice-minPrice)*mainChartHeight;
  const yToPrice=y=>maxPrice-((y-padding)/mainChartHeight)*(maxPrice-minPrice);

  /* PRICE GRID */
  ctx.font="12px Arial";
  ctx.strokeStyle="#1f2630";
  ctx.fillStyle="#aaa";
  for(let i=0;i<=6;i++){
   const price=minPrice+(i/6)*(maxPrice-minPrice),y=priceToY(price);
   ctx.beginPath();ctx.moveTo(padding,y);ctx.lineTo(padding+chartWidth,y);ctx.stroke();
   ctx.fillText(formatPrice(price),padding+chartWidth+5,y+4);
  }

  /* TIME GRID */
  const numTicks=Math.max(2,Math.floor(chartWidth/100));
  const step=Math.ceil(data.length/numTicks);
  ctx.textAlign="center";
  for(let i=0;i<data.length;i+=step){
   const x=padding+i*candleWidth+candleWidth/2;
   ctx.strokeStyle="#1f2630";
   ctx.beginPath();ctx.moveTo(x,padding);ctx.lineTo(x,padding+mainChartHeight);ctx.stroke();
   ctx.fillStyle="#aaa";
   ctx.fillText(timeLabel(data[i][0],interval),x,padding+chartHeight+20);
  }
  ctx.textAlign="left";

  /* CANDLES */
  data.forEach((d,i)=>{
   const [,open,high,low,close]=d;
   
   // Хэрэв утга нь тоо биш (NaN) байвал зурахгүй алгасах хамгаалалт
   if(!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return;

   const x=padding+i*candleWidth;
   const yO=priceToY(open),yC=priceToY(close),yH=priceToY(high),yL=priceToY(low);
   
   // Координатуудfinite эсэхийг шалгах
   if(!Number.isFinite(yO) || !Number.isFinite(yC) || !Number.isFinite(yH) || !Number.isFinite(yL)) return;

   const bull=close>=open;

   const grd=ctx.createLinearGradient(x,yH,x,yL);
   grd.addColorStop(0,bull?"#3ee69b":"#ffffff");
   grd.addColorStop(1,bull?"#0ecb81":"#ffffff");
   ctx.fillStyle=grd;
   ctx.strokeStyle=bull?"#0ecb81":"#ffffff";
   ctx.shadowBlur=0;
   ctx.shadowColor="transparent";

   ctx.beginPath();
   ctx.moveTo(x+candleWidth/2,yH);
   ctx.lineTo(x+candleWidth/2,yL);
   ctx.stroke();
   ctx.fillRect(x+candleWidth*0.2,Math.min(yO,yC),candleWidth*0.6,Math.max(1,Math.abs(yO-yC)));
  });

  /* BACKTEST EVENTS */
  try{
   drawBacktestEvents(ctx,data,padding,chartWidth,candleWidth,priceToY,start);
  }catch(err){console.error("[BACKTEST DRAW ERROR]",err)}

  /* LAST PRICE LINE */
  const lastClose=data[data.length-1][4],yLast=priceToY(lastClose);
  ctx.setLineDash([5,5]);
  ctx.strokeStyle="#f0b90b";
  ctx.beginPath();ctx.moveTo(padding,yLast);ctx.lineTo(padding+chartWidth,yLast);ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle="#f0b90b";
  ctx.fillText(formatPrice(lastClose),padding+chartWidth+5,yLast-4);

  /* GLOBAL CROSSHAIR */
  if(mouse.x!==null&&mouse.x>padding&&mouse.x<padding+chartWidth&&
     mouse.y!==null&&mouse.y>=padding&&mouse.y<=padding+chartHeight){
   const ci=Math.floor((mouse.x-padding)/candleWidth);
   if(ci>=0&&ci<data.length){
    const candle=data[ci];
    const cx=padding+ci*candleWidth+candleWidth/2;

    /* vertical */
    ctx.save();
    ctx.strokeStyle="rgba(255,255,255,0.35)";
    ctx.lineWidth=1;
    ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(cx,padding);ctx.lineTo(cx,padding+chartHeight);ctx.stroke();
    ctx.restore();

    /* price horizontal */
    if(mouse.y<=padding+mainChartHeight){
     ctx.save();
     ctx.strokeStyle="#666";
     ctx.lineWidth=1;
     ctx.setLineDash([4,4]);
     ctx.beginPath();ctx.moveTo(padding,mouse.y);ctx.lineTo(padding+chartWidth,mouse.y);ctx.stroke();
     ctx.setLineDash([]);
     ctx.fillStyle="#111";
     ctx.fillRect(padding+chartWidth,mouse.y-10,priceScaleWidth,20);
     ctx.fillStyle="#fff";
     ctx.font="11px Arial";
     ctx.textBaseline="middle";
     ctx.fillText(formatPrice(yToPrice(mouse.y)),padding+chartWidth+5,mouse.y);
     ctx.restore();
    }

    /* time label box */
    const ts=Number(candle[0]);
    if(Number.isFinite(ts)){
     const bw=58,bh=18;
     const bx=Math.max(padding,Math.min(cx-bw/2,padding+chartWidth-bw));
     const by=padding+chartHeight+5;
     ctx.save();
     ctx.fillStyle="#111";
     ctx.fillRect(bx,by,bw,bh);
     ctx.strokeStyle="#666";
     ctx.strokeRect(bx,by,bw,bh);
     ctx.fillStyle="#fff";
     ctx.font="10px Arial";
     ctx.textAlign="center";
     ctx.textBaseline="middle";
     ctx.fillText(timeLabel(ts,interval),bx+bw/2,by+bh/2);
     ctx.textAlign="left";
     ctx.restore();
    }
   }
  }

  /* OHLC HEADER */
  let ac=data[data.length-1];
  if(mouse.x&&mouse.y&&mouse.x>padding&&mouse.x<padding+chartWidth&&mouse.y>padding&&mouse.y<padding+mainChartHeight){
   const idx=Math.floor((mouse.x-padding)/candleWidth);
   if(data[idx])ac=data[idx];
  }
  const cc=ac[4]>=ac[1]?"#0ecb81":"#f6465d";
  drawLabels(ctx,padding+10,padding+5,[
   [symbol+"  O:",formatPrice(ac[1]),cc],
   ["H:",formatPrice(ac[2])],
   ["L:",formatPrice(ac[3])],
   ["C:",formatPrice(ac[4]),cc]
  ]);

  drawMACD(ctx,data,window.macdArrayData,window.signalArrayData,window.histArrayData,padding,chartWidth,chartHeight,candleWidth,mouse,mainChartHeight,macdRatio);
  drawRSI(ctx,data,window.rsiArrayData,padding,chartWidth,chartHeight,candleWidth,mouse,mainChartHeight,macdRatio,rsiRatio);
  drawATR(ctx,data,window.atrArrayData,padding,chartWidth,chartHeight,candleWidth,mouse,mainChartHeight,macdRatio,rsiRatio,atrRatio);
 }

 window.redrawChart=draw;

async function fetchCandles(){
 try{
    interval = "1m"; 
    symbol = "GOLD";
    
    // 1. Бүх датаг зэрэг татаж авах (Candles, RSI, MACD Arrays)
    const [candlesRes, rsiRes, arraysRes] = await Promise.all([
        fetch("/candles/GOLD"),
        fetch("/rsi/GOLD"),
        fetch("/arrays/GOLD") // <-- /macd/GOLD биш /arrays/GOLD рүү хандана
    ]);

    if(!candlesRes.ok) throw new Error(`HTTP ${candlesRes.status}`);
    
    const candleData = await candlesRes.json();
    const candles = candleData.candles || [];
    
    // OHLCV датаг оноох
    window.allData = candles.map(d => {
        const time = d[0];
        const open = d[1];
        const high = d[2];
        const low = d[3];
        const close = d[4];
        const volume = d[5];
        return [Number(time), Number(open), Number(high), Number(low), Number(close), Number(volume)];
    });

    // 2. RSI массив оноох
    if(rsiRes.ok) {
        const rsiJson = await rsiRes.json();
        window.rsiArrayData = rsiJson.rsi_array || []; 
    }

    // 3. MACD массивуудыг /arrays/GOLD endpoint-оос оноох
    if(arraysRes.ok) {
        const arraysJson = await arraysRes.json();
        window.macdArrayData = arraysJson.macd_line_array || [];
        window.signalArrayData = arraysJson.macd_signal_array || [];
        window.histArrayData = arraysJson.macd_histogram_array || [];
    }

    draw();
    dispatchChartUpdate();
 }catch(e){console.error("[META CHART / FLASK DATA ERROR]",e)}
}

 async function fetchBacktest(){
  try{
   const r=await fetch("/api/backtest");
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   window.backtestEvents=(await r.json()).events||[];
   draw();
  }catch(e){
   console.error("[BACKTEST ERROR]",e);
   window.backtestEvents=[];
  }
 }

 let updateTimer=null;
 const triggerAutoUpdate=()=>{
  clearTimeout(updateTimer);
  updateTimer=setTimeout(async()=>{
   if(!coinEl||!intervalEl)return;
   interval=intervalEl.value;
   symbol=coinEl.value.toUpperCase().replace(/[^A-Z0-9]/g,'')||"GOLD";
   offset=0;visibleCount=80;priceScale=1;priceOffset=0;
   await fetchCandles();
   await fetchBacktest();
  },150);
 };

 if(marketEl)marketEl.addEventListener("change",triggerAutoUpdate);
 if(intervalEl)intervalEl.addEventListener("change",triggerAutoUpdate);
 if(coinEl){
  coinEl.addEventListener("change",triggerAutoUpdate);
  coinEl.addEventListener("keydown",e=>{if(e.key==="Enter")triggerAutoUpdate()});
 }

 /* ▲ ■ ▼ товчлуурууд */
  const panels=[
  ["macdMode","_macdTop","_btnMaxX","_btnNormX","_btnMinX"],
  ["rsiMode","_rsiTop","_btnRsiMaxX","_btnRsiNormX","_btnRsiMinX"],
  ["atrMode","_atrTop","_btnAtrMaxX","_btnAtrNormX","_btnAtrMinX"]
 ];
 const resetModes=()=>{window.macdMode=window.rsiMode=window.atrMode='normal'};

 canvas.addEventListener("click",e=>{
  const rect=canvas.getBoundingClientRect();
  const cx=e.clientX-rect.left,cy=e.clientY-rect.top;
  const hit=k=>cx>=window[k]&&cx<=window[k]+16;

  for(const [K,top,bMax,bNorm,bMin] of panels){
   if(!(cy>=window[top]&&cy<=window[top]+20))continue;
   if(hit(bMax)){const v=window[K]==='max'?'normal':'max';resetModes();window[K]=v;draw();return}
   if(hit(bNorm)){resetModes();draw();return}
   if(hit(bMin)){const v=window[K]==='min'?'normal':'min';resetModes();window[K]=v;draw();return}
  }
 });

 canvas.addEventListener("mousemove",e=>{
  const rect=canvas.getBoundingClientRect();
  mouse.x=e.clientX-rect.left;
  mouse.y=e.clientY-rect.top;

  if(draggingPrice){
   const dy=e.clientY-lastY;
   lastY=e.clientY;
   priceScale=Math.max(0.1,Math.min(priceScale*(1+dy*0.005),10));
   draw();
   return;
  }

  if(dragging){
   const dx=e.clientX-lastX;
   const cw=(canvas.width-PAD*4-PSW)/visibleCount;   // 1 свечийн өргөн (px)
   const move=Math.trunc(dx/cw);
   if(move!==0){
    offset=Math.max(0,Math.min(window.allData.length-visibleCount,offset+move));
    lastX+=move*cw;   // үлдэгдлийг хадгалж, тасалдахгүй гулсуулна
   }

   const dy=e.clientY-lastY;
   if(lastChartHeight>0)priceOffset+=dy*(lastPriceRange/lastChartHeight);
   lastY=e.clientY;
  }

  canvas.style.cursor=mouse.x>canvas.width-PAD-PSW?"ns-resize":dragging?"grabbing":"crosshair";
  draw();
 });

 canvas.addEventListener("mousedown",e=>{
  if(mouse.x>canvas.width-PAD-PSW){
   draggingPrice=true;
   lastY=e.clientY;
  }else{
   dragging=true;
   lastX=e.clientX;
   lastY=e.clientY;
  }
 });

 canvas.addEventListener("mouseup",()=>{dragging=draggingPrice=false});

 canvas.addEventListener("mouseleave",()=>{
  dragging=draggingPrice=false;
  mouse.x=null;
  draw();
 });

 canvas.addEventListener("dblclick",()=>{priceScale=1;priceOffset=0;draw()});

 canvas.addEventListener("wheel",e=>{
  e.preventDefault();
  const zoomStep=30;   // ← хурдыг эндээс тохируулна
  visibleCount=Math.max(minVisible,Math.min(maxVisible,visibleCount+(e.deltaY>0?zoomStep:-zoomStep)));
  offset=Math.max(0,Math.min(offset,Math.max(0,window.allData.length-visibleCount)));
  draw();
 },{passive:false});

 fetchCandles();
});

/* Индикатор бүрийн булангийн товчлуурууд */
function drawWindowButtons(ctx,topY,chartWidth,padding,maxRef,normRef,minRef){
 const btnY=topY+4;
 const minX=padding+chartWidth-10-14,normX=minX-18,maxX=normX-18;
 window[maxRef]=maxX;window[normRef]=normX;window[minRef]=minX;

 ctx.fillStyle="#1f2630";
 [maxX,normX,minX].forEach(x=>ctx.fillRect(x,btnY,14,14));

 ctx.fillStyle="#aaa";
 ctx.font="9px Arial";
 ctx.textAlign="center";
 ctx.textBaseline="middle";
 ctx.fillText("▲",maxX+7,btnY+7);
 ctx.fillText("■",normX+7,btnY+7);
 ctx.fillText("▼",minX+7,btnY+7);
 ctx.textAlign="left";
 ctx.textBaseline="top";
}

function drawMACD(ctx,data,macdArray,signalArray,histArray,padding,chartWidth,chartHeight,candleWidth,mouseObj,mainChartHeight,macdRatio){
 if(!macdArray||!macdArray.length)return;

 const macdTop=padding+mainChartHeight+20;
 window._macdTop=macdTop;
 const macdHeight=chartHeight*macdRatio-15;

 const startIdx=(window._chartStartIndex??0)+(macdArray.length-window.allData.length);
 const at=(arr,idx)=>idx>=0&&idx<arr.length?Number(arr[idx])||0:0;

 const vis=[];
 data.forEach((d,i)=>{
  const idx=startIdx+i;
  if(idx>=0&&idx<macdArray.length)vis.push(at(macdArray,idx),at(signalArray,idx),at(histArray,idx));
 });

 let maxM=Math.max(...vis,0),minM=Math.min(...vis,0);
 if(maxM===minM){maxM=1;minM=-1}

 const macdToY=v=>macdTop+macdHeight-((v-minM)/(maxM-minM))*macdHeight;

 ctx.strokeStyle="#1f2630";
 ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(padding,macdTop);ctx.lineTo(padding+chartWidth,macdTop);ctx.stroke();

 if(window.macdMode!=='min'){
  /* histogram */
  const yZero=macdToY(0);
  data.forEach((d,i)=>{
   const h=at(histArray,startIdx+i),yVal=macdToY(h);
   ctx.fillStyle=h>=0?"#0ecb81":"#f6465d";
   ctx.fillRect(padding+i*candleWidth+candleWidth*0.1,Math.min(yZero,yVal),candleWidth*0.8,Math.max(1,Math.abs(yZero-yVal)));
  });

  /* MACD + signal lines */
  [[macdArray,"#2962ff"],[signalArray,"#ff9800"]].forEach(([arr,color])=>{
   ctx.strokeStyle=color;
   ctx.lineWidth=1.5;
   ctx.beginPath();
   data.forEach((d,i)=>{
    const x=padding+i*candleWidth+candleWidth/2,y=macdToY(at(arr,startIdx+i));
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
   });
   ctx.stroke();
  });
 }

 /* active values */
 const g=startIdx+activeIndex(mouseObj,padding,chartWidth,candleWidth,data.length);
 if(g>=0&&g<macdArray.length){
  const m=Number(macdArray[g]||0).toFixed(8);
  const s=Number(signalArray[g]||0).toFixed(8);
  const h=Number(histArray[g]||0).toFixed(8);
  drawLabels(ctx,padding+10,macdTop+6,[
   ["MACD(12, 26, 9):",m,"#2962ff"],
   ["Signal:",s,"#ff9800"],
   ["Hist:",h,Number(h)>=0?"#0ecb81":"#f6465d"]
  ]);
 }

 drawWindowButtons(ctx,macdTop,chartWidth,padding,'_btnMaxX','_btnNormX','_btnMinX');
}

function drawRSI(ctx,data,rsiArray,padding,chartWidth,chartHeight,candleWidth,mouseObj,mainChartHeight,macdRatio,rsiRatio){
 if(!rsiArray||!rsiArray.length)return;

 const startIdx=(window._chartStartIndex??0)+(rsiArray.length-window.allData.length);
 const rsiTop=padding+mainChartHeight+chartHeight*macdRatio+25;
 window._rsiTop=rsiTop;
 const rsiHeight=chartHeight*rsiRatio-20;
 const rsiToY=v=>rsiTop+rsiHeight-(v/100)*rsiHeight;

 ctx.strokeStyle="#1f2630";
 ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(padding,rsiTop);ctx.lineTo(padding+chartWidth,rsiTop);ctx.stroke();

 if(window.rsiMode!=='min'){
  ctx.setLineDash([3,3]);
  ctx.strokeStyle="#2a2e39";
  [70,30].forEach(lv=>{
   const y=rsiToY(lv);
   ctx.beginPath();ctx.moveTo(padding,y);ctx.lineTo(padding+chartWidth,y);ctx.stroke();
  });
  ctx.setLineDash([]);

  ctx.strokeStyle="#e91e63";
  ctx.lineWidth=1.5;
  ctx.beginPath();
  data.forEach((d,i)=>{
   const idx=startIdx+i;
   const x=padding+i*candleWidth+candleWidth/2;
   const v=idx>=0&&idx<rsiArray.length&&rsiArray[idx]!==undefined?rsiArray[idx]:50;
   const y=rsiToY(v);
   i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.stroke();
 }

 const g=startIdx+activeIndex(mouseObj,padding,chartWidth,candleWidth,data.length);
 if(g>=0&&g<rsiArray.length&&rsiArray[g]!==undefined)
  drawLabels(ctx,padding+10,rsiTop+6,[["RSI(7): ",Number(rsiArray[g]).toFixed(2),"#e91e63"]]);

 drawWindowButtons(ctx,rsiTop,chartWidth,padding,'_btnRsiMaxX','_btnRsiNormX','_btnRsiMinX');
}

function drawATR(ctx,data,atrArray,padding,chartWidth,chartHeight,candleWidth,mouseObj,mainChartHeight,macdRatio,rsiRatio,atrRatio){
 if(!atrArray||!atrArray.length)return;

 const startIdx=(window._chartStartIndex??0)+(atrArray.length-window.allData.length);
 const atrTop=padding+mainChartHeight+chartHeight*(macdRatio+rsiRatio)+30;
 window._atrTop=atrTop;
 const atrHeight=chartHeight*atrRatio-20;

 const vis=[];
 data.forEach((d,i)=>{
  const idx=startIdx+i;
  const v=idx>=0&&idx<atrArray.length?atrArray[idx]:null;
  if(Number.isFinite(v))vis.push(v);
 });

 let maxA=vis.length?Math.max(...vis):1,minA=vis.length?Math.min(...vis):0;
 if(maxA===minA){maxA+=1;minA-=1}
 const pd=(maxA-minA)*0.1;maxA+=pd;minA-=pd;
 const atrToY=v=>atrTop+atrHeight-((v-minA)/(maxA-minA))*atrHeight;

 ctx.strokeStyle="#1f2630";
 ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(padding,atrTop);ctx.lineTo(padding+chartWidth,atrTop);ctx.stroke();

 if(window.atrMode!=='min'){
  ctx.strokeStyle="#22d3ee";
  ctx.lineWidth=1.5;
  ctx.beginPath();
  let started=false;
  data.forEach((d,i)=>{
   const idx=startIdx+i;
   const v=idx>=0&&idx<atrArray.length?atrArray[idx]:null;
   if(!Number.isFinite(v))return;
   const x=padding+i*candleWidth+candleWidth/2,y=atrToY(v);
   started?ctx.lineTo(x,y):ctx.moveTo(x,y);
   started=true;
  });
  ctx.stroke();

  /* min/max шкал */
  ctx.font="9px Arial";ctx.textBaseline="middle";ctx.fillStyle="#666";
  ctx.fillText(maxA.toFixed(2),padding+chartWidth+5,atrToY(maxA));
  ctx.fillText(minA.toFixed(2),padding+chartWidth+5,atrToY(minA));
 }

 const g=startIdx+activeIndex(mouseObj,padding,chartWidth,candleWidth,data.length);
 if(g>=0&&g<atrArray.length&&Number.isFinite(atrArray[g])){
  const per=typeof indicatorSettings!=="undefined"?indicatorSettings.atrPeriod:14;
  drawLabels(ctx,padding+10,atrTop+6,[[`ATR(${per}): `,Number(atrArray[g]).toFixed(3),"#22d3ee"]]);
 }

 drawWindowButtons(ctx,atrTop,chartWidth,padding,'_btnAtrMaxX','_btnAtrNormX','_btnAtrMinX');
}

function drawBacktestEvents(ctx,data,padding,chartWidth,candleWidth,priceToY,start){
 const events=window.backtestEvents||[];
 if(!events.length||!data.length)return;

 const ONE_MINUTE=60000;

 /* CLOSE болсон position-ийг OPEN-той нь match хийж хасна, зөвхөн нээлттэй нь үлдэнэ */
 const open=[];
 events.forEach(ev=>{
  if(!ev||!ev.action)return;
  const a=String(ev.action).toUpperCase();
  const side=a.includes("LONG")?"LONG":"SHORT";
  if(a.includes("OPEN"))open.push({side,event:ev});
  else{
   for(let i=open.length-1;i>=0;i--){
    if(open[i].side===side){open.splice(i,1);break}
   }
  }
 });

 ctx.save();

 open.forEach(({side,event})=>{
  if(!event.time)return;
  const eventTime=new Date(String(event.time).replace(" ","T")+"Z").getTime();
  if(!Number.isFinite(eventTime))return;

  /* хамгийн ойр candle */
  let li=-1,best=Infinity;
  for(let i=0;i<data.length;i++){
   const ct=Number(data[i][0]);
   if(!Number.isFinite(ct))continue;
   const diff=Math.abs(ct-eventTime);
   if(diff<best){best=diff;li=i}
  }
  if(li<0||best>ONE_MINUTE)return;

  const price=Number(event.price);
  if(!Number.isFinite(price))return;

  const isLong=side==="LONG";
  const color=isLong?"#0ecb81":"#f6465d";
  const x=padding+li*candleWidth+candleWidth/2;
  const y=priceToY(price);
  const markerY=isLong?y+14:y-14;

  /* connector */
  ctx.strokeStyle=color;
  ctx.lineWidth=1;
  ctx.globalAlpha=0.45;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,markerY);ctx.stroke();
  ctx.globalAlpha=1;

  /* triangle */
  const s=6;
  ctx.fillStyle=color;
  ctx.beginPath();
  if(isLong){
   ctx.moveTo(x,markerY+s);ctx.lineTo(x-s,markerY-s);ctx.lineTo(x+s,markerY-s);
  }else{
   ctx.moveTo(x,markerY-s);ctx.lineTo(x-s,markerY+s);ctx.lineTo(x+s,markerY+s);
  }
  ctx.closePath();
  ctx.fill();

  /* label */
  ctx.font="bold 10px Arial";
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  const w=ctx.measureText(side).width+10,h=16;
  const labelY=isLong?markerY-13:markerY+13;

  ctx.fillStyle="rgba(5, 7, 10, 0.90)";
  ctx.fillRect(x-w/2,labelY-h/2,w,h);
  ctx.strokeStyle=color;
  ctx.lineWidth=1;
  ctx.strokeRect(x-w/2,labelY-h/2,w,h);
  ctx.fillStyle=color;
  ctx.fillText(side,x,labelY);

  /* price */
  ctx.font="9px Arial";
  ctx.fillStyle="#aaa";
  ctx.fillText(formatPrice(price),x,isLong?labelY-13:labelY+13);
 });

 ctx.restore();
}
