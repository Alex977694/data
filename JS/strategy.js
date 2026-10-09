"use strict";

/* =========================================================
   DEFAULT TEST STRATEGY
========================================================= */
const DEFAULT_TEST_STRATEGY = {
  "version": 1,
  "strategy_name": "GOLD 1M Hedge Strategy",
  "positionMode": {
    "LONG": "SINGLE",
    "SHORT": "SINGLE"
  },
  "maxPositions": {
    "LONG": 1,
    "SHORT": 1
  },
  "indicators": {
    "rsiPeriod": 7,
    "rsiSource": "close",
    "macdFast": 12,
    "macdSlow": 26,
    "macdSignal": 9
  },
  "conditions": {
    "longOpen": [
      {
                "left": "candle_close_0",
        "operator": ">",
        "rightType": "value",
                "right": "candle_close_1",
        "logic": "AND"
      }
    ],
    "longReset": [],
    "longExit": [
      {
                "left": "candle_close_0",
        "operator": "<",
        "rightType": "value",
                "right": "candle_close_1",
        "logic": "AND"
      }
    ],
    "shortOpen": [
      {
                "left": "candle_close_0",
        "operator": "<",
        "rightType": "value",
                "right": "candle_close_1",
        "logic": "AND"
      }
    ],
    "shortReset": [],
    "shortExit": [
      {
                "left": "candle_close_0",
        "operator": ">",
        "rightType": "value",
                "right": "candle_close_1",
        "logic": "AND"
      }
    ]
  }
};

function serializeCondition(c){
    return { left: c.left, operator: c.operator, rightType: c.rightType, right: c.right, logic: c.logic || "AND", readyClose: !!c.readyClose };
}

function buildStrategyJSON(){
    return {
        version: 1,
        strategy_name: "GOLD 1M Hedge Strategy",
        positionMode: { LONG: positionMode.LONG, SHORT: positionMode.SHORT },
        maxPositions: { LONG: Number(maxPositions.LONG), SHORT: Number(maxPositions.SHORT) },
        indicators: {
            rsiPeriod: Number(indicatorSettings.rsiPeriod),
            rsiSource: indicatorSettings.rsiSource,
            macdFast: Number(indicatorSettings.macdFast),
            macdSlow: Number(indicatorSettings.macdSlow),
            macdSignal: Number(indicatorSettings.macdSignal),
            atrPeriod: Number(indicatorSettings.atrPeriod)
        },

        conditions: {
            longOpen: groups.longOpen.map(serializeCondition),
            longReset: groups.longReset.map(serializeCondition),
            longExit: groups.longExit.map(serializeCondition),
            longReadyClose: groups.longReadyClose.map(serializeCondition),

            shortOpen: groups.shortOpen.map(serializeCondition),
            shortReset: groups.shortReset.map(serializeCondition),
            shortExit: groups.shortExit.map(serializeCondition),
            shortReadyClose: groups.shortReadyClose.map(serializeCondition)
        }
    };
}

/* =========================================================
   REFRESH JSON TEXTAREA
========================================================= */
function refreshStrategyJSON(){
    const json = buildStrategyJSON();
    $("strategyJson").value = JSON.stringify(json, null, 2);
}

/* =========================================================
   IMPORT JSON
========================================================= */
function loadStrategyJSON(data){
    if(!data || typeof data !== "object"){
        throw new Error("Invalid strategy JSON.");
    }

    if(!data.conditions){
        throw new Error("JSON does not contain conditions.");
    }

    /* POSITION MODE */
    if(data.positionMode){
        if(
            data.positionMode.LONG === "SINGLE" ||
            data.positionMode.LONG === "MANY"
        ){
            positionMode.LONG = data.positionMode.LONG;
        }

        if(
            data.positionMode.SHORT === "SINGLE" ||
            data.positionMode.SHORT === "MANY"
        ){
            positionMode.SHORT = data.positionMode.SHORT;
        }
    }

    /* MAX POSITIONS */
    if(data.maxPositions){
        const longMax = Number(data.maxPositions.LONG);
        const shortMax = Number(data.maxPositions.SHORT);

        if(Number.isFinite(longMax) && longMax >= 1){
            maxPositions.LONG = longMax;
        }

        if(Number.isFinite(shortMax) && shortMax >= 1){
            maxPositions.SHORT = shortMax;
        }
    }

    /* INDICATORS */
    if(data.indicators){
        const x = data.indicators;

        if(Number.isInteger(Number(x.rsiPeriod))){
            indicatorSettings.rsiPeriod = Number(x.rsiPeriod);
        }

        if(["open", "high", "low", "close"].includes(x.rsiSource)){
            indicatorSettings.rsiSource = x.rsiSource;
        }

        if(Number.isInteger(Number(x.macdFast))){
            indicatorSettings.macdFast = Number(x.macdFast);
        }

        if(Number.isInteger(Number(x.macdSlow))){
            indicatorSettings.macdSlow = Number(x.macdSlow);
        }

        if(Number.isInteger(Number(x.macdSignal))){
            indicatorSettings.macdSignal = Number(x.macdSignal);
        }

        if(Number.isInteger(Number(x.atrPeriod))){
            indicatorSettings.atrPeriod = Number(x.atrPeriod);
        }
    }

    /* CONDITIONS */
    const conditionGroups = [
        "longOpen",
        "longReset",
        "longExit",
        "longReadyClose",
        "shortOpen",
        "shortReset",
        "shortExit",
        "shortReadyClose"
    ];

    conditionGroups.forEach(type => {
        groups[type] = [];

        const source = Array.isArray(data.conditions[type])
            ? data.conditions[type]
            : [];

        source.forEach(x => {
            const c = condition();

            c.left = x.left || "";
            c.operator = x.operator || ">";
            c.rightType = x.rightType || "value";
            c.right = x.right !== undefined ? String(x.right) : "";
            c.logic = x.logic === "OR" ? "OR" : "AND";
            c.readyClose = !!x.readyClose;

            groups[type].push(c);
        });
    });

    /* UPDATE INDICATOR INPUTS */
    $("rsiPeriod").value = indicatorSettings.rsiPeriod;
    $("rsiSource").value = indicatorSettings.rsiSource;
    $("macdFast").value = indicatorSettings.macdFast;
    $("macdSlow").value = indicatorSettings.macdSlow;
    $("macdSignal").value = indicatorSettings.macdSignal;

    const atrInput = $("atrPeriod");
    if(atrInput){
        atrInput.value = indicatorSettings.atrPeriod;
    }

    /* UPDATE POSITION RADIO */
    [["LONG", "long"], ["SHORT", "short"]].forEach(([side, name]) => {
        const radio = document.querySelector(
            `input[name="${name}PositionMode"][value="${positionMode[side]}"]`
        );

        if(radio){
            radio.checked = true;
        }

        const wrap = $(name + "MaxPosWrap");
        const input = $(name + "MaxPos");

        if(wrap){
            wrap.style.display =
                positionMode[side] === "MANY"
                    ? "inline-flex"
                    : "none";
        }

        if(input){
            input.value = maxPositions[side];
        }
    });

    /* RENDER */
    Object.keys(groups).forEach(type => {
        renderGroup(type);
        preview(type);
    });

    updateModeVisibility("LONG");
    updateModeVisibility("SHORT");

    applyIndicators();
    refreshStrategyJSON();
}


/* =========================================================
   COPY
========================================================= */
$("copyStrategy").onclick = async () => {
    refreshStrategyJSON();
    try{
        await navigator.clipboard.writeText($("strategyJson").value);
        $("refreshStatus").textContent = "✅ Strategy JSON copied to clipboard.";
    }catch(e){
        $("strategyJson").select();
        document.execCommand("copy");
        $("refreshStatus").textContent = "✅ Strategy JSON copied.";
    }
};

/* =========================================================
   PASTE
========================================================= */
$("pasteStrategy").onclick = async () => {
    try{
        const text = await navigator.clipboard.readText();
        if(!text.trim()) throw new Error("Clipboard is empty.");
        $("strategyJson").value = text;
        $("refreshStatus").textContent = "JSON pasted. Click IMPORT JSON.";
    }catch(e){
        alert("Clipboard read failed.\n\nPaste JSON manually into the box.");
    }
};

/* =========================================================
   IMPORT
========================================================= */
$("importStrategy").onclick = () => {
    const text = $("strategyJson").value.trim();
    if(!text){
        $("strategyFile").click();
        return;
    }
    try{
        const data = JSON.parse(text);
        loadStrategyJSON(data);
        $("refreshStatus").textContent = "✅ Strategy imported successfully.";
    }catch(e){
        console.error(e);
        alert("IMPORT STRATEGY ERROR:\n\n" + e.message);
    }
};

/* =========================================================
   EXPORT
========================================================= */
$("exportStrategy").onclick = () => {
    try{
        refreshStrategyJSON();
        const text = $("strategyJson").value;
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "gold_strategy.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        $("refreshStatus").textContent = "✅ Strategy exported: gold_strategy.json";
    }catch(e){
        alert("EXPORT ERROR:\n" + e.message);
    }
};

/* =========================================================
   FILE IMPORT
========================================================= */
$("strategyFile").onchange = async e => {
    const file = e.target.files[0];
    if(!file) return;
    try{
        const text = await file.text();
        $("strategyJson").value = text;
        const data = JSON.parse(text);
        loadStrategyJSON(data);
        $("refreshStatus").textContent = `✅ ${file.name} imported successfully.`;

    }catch(err){
        console.error(err);
        alert("JSON FILE ERROR:\n\n" + err.message);
    }finally{
        e.target.value = "";
    }
};

/* =========================================================
   CLEAR
========================================================= */
$("clearStrategy").onclick = () => {
    if(!confirm("Clear all strategy conditions?")) return;
    Object.keys(groups).forEach(type => {
        groups[type] = [];
        renderGroup(type);
        preview(type);
    });
    refreshStrategyJSON();
    $("refreshStatus").textContent = "Strategy cleared.";
};

/* =========================================================
   AUTO UPDATE JSON
========================================================= */
function autoStrategyJSON(){
    try{
        refreshStrategyJSON();
    }catch(e){
        console.error("Strategy JSON update error:", e);
    }
}
