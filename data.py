import os
import json
import threading
import time
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
import websocket
from binance.um_futures import UMFutures
from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn
import requests
import pandas as pd
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from ohlc_data import calculate_ohlc_tracker_report
from ema_data import calculate_ema_report
from data_topmovers import calculate_top_movers_report
from data_newmovers import calculate_new_movers_report
from rsi import (
    calculate_rsi_values,
    calculate_rsi_cross,
    calculate_rsi_states,
    calculate_rsi_laststatus,
    calculate_rsi_trend,
    calculate_rsi_average
)
from macd import (
    calculate_macd_values,
    calculate_macd_cross,
    calculate_macd_state,
    calculate_macd_trend,
    calculate_macd_average,
    calculate_macd_limits,
    calculate_macd_initial_crosses,
    calculate_macd_peaks
)
from arrays import calculate_rsi_array, calculate_macd_arrays

# ==================== CONFIG ====================
MAX_KLINES = 300  # Лааны түүхэн датаны хязгаар
MAX_GOLD_CANDLES = 10000
REST_WORKERS = 10
WS_PING_INTERVAL = 20
WS_PING_TIMEOUT = 10
WS_URL = "wss://fstream.binance.com/market/stream"

# ==================== STATE ====================
kline_history = {}
cache_lock = threading.Lock()
closed_kline_count = 0
last_kline_time = 0

# Бот болон Daemon удирдах флагууд
daemon_is_running = False
daemon_thread = None
daemon_lock = threading.Lock()
ws_app = None  # WebSocket-г гаднаас нь зогсооход зориулав

selected_symbols = set()
selected_lock = threading.Lock()

# ==================== FASTAPI APP ====================
app = FastAPI(title="Binance Controlled Candle Data Daemon")

from fastapi.staticfiles import StaticFiles

# Сервер дээр JS хавтсаа холбох
app.mount("/JS", StaticFiles(directory="JS"), name="JS")

@app.get("/")
def root():
    with cache_lock:
        data = {
            "status": "running" if daemon_is_running else "stopped",
            "symbols_loaded": len(kline_history),
            "closed_candles_count": closed_kline_count,
            "last_closed_time": last_kline_time
        }
        return JSONResponse(content=jsonable_encoder(data))

@app.get("/railway-ip")
def get_railway_public_ip():
    """Railway серверийн гадагшаа гарч буй Public IP-г шалгах"""
    try:
        response = requests.get("https://api.ipify.org?format=json", timeout=5)
        return JSONResponse(content=jsonable_encoder(response.json()))
    except Exception as e:
        return JSONResponse(content=jsonable_encoder({"error": str(e)}))

# ==================== START / STOP CONTROL ====================
@app.get("/start")
def start_daemon():
    global daemon_is_running, daemon_thread
    with daemon_lock:
        if daemon_is_running:
            return {"status": "already running"}
        daemon_is_running = True
        daemon_thread = threading.Thread(target=start_background_daemon, daemon=True)
        daemon_thread.start()
    return {"status": "daemon started successfully"}

@app.get("/stop")
def stop_daemon():
    global daemon_is_running, ws_app
    with daemon_lock:
        if not daemon_is_running:
            return {"status": "already stopped"}
        daemon_is_running = False
        
        # WebSocket ажиллаж байгаа бол шууд хаах
        if ws_app:
            try:
                ws_app.close()
            except Exception:
                pass
                
    return {"status": "stop signal sent"}

@app.get("/status")
def daemon_status():
    with cache_lock:
        return {
            "is_running": daemon_is_running,
            "symbols_loaded": len(kline_history),
            "closed_candles_count": closed_kline_count
        }

# ==================== SELECTED SYMBOLS STATE ====================

@app.get("/choose/{symbol}")
def choose_symbol(symbol: str):
    symbol = symbol.upper()
    with selected_lock:
        selected_symbols.add(symbol)
    return {"status": "success", "message": f"{symbol} added to selected list", "selected_symbols": list(selected_symbols)}

@app.get("/delete/{symbol}")
def delete_symbol(symbol: str):
    symbol = symbol.upper()
    with selected_lock:
        if symbol in selected_symbols:
            selected_symbols.remove(symbol)
    return {"status": "success", "message": f"{symbol} removed from selected list", "selected_symbols": list(selected_symbols)}

@app.get("/selected-symbols")
def get_selected_symbols():
    with selected_lock:
        return {"selected_symbols": list(selected_symbols)}
    
from fastapi import FastAPI, HTTPException, Query

# ==================== RSI ENDPOINT ====================
from fastapi import FastAPI, HTTPException, Query
import traceback

from fastapi import FastAPI, HTTPException, Query
import pandas as pd
from ta.momentum import RSIIndicator
import traceback

# ==================== RSI ENDPOINT ====================
@app.get("/rsi/{symbol}")
def get_symbol_rsi(symbol: str, period: int = 7, source: str = "close"):
    symbol = symbol.upper()
    source_index = {"open": 1, "high": 2, "low": 3, "close": 4}.get(source.lower())
    if source_index is None:
        raise HTTPException(status_code=400, detail="RSI source must be open, high, low, or close")
    with cache_lock:
        if symbol not in kline_history:
            raise HTTPException(status_code=404, detail="Symbol not found or not loaded yet")
        klines = kline_history[symbol]

    try:
        # RSI массивыг авах (таны эхний код дээр байсан хэсэг)
        source_values = [float(kline[source_index]) for kline in klines]
        rsi_series = RSIIndicator(close=pd.Series(source_values), window=int(period)).rsi().dropna()
        rsi_arrays = {
            "rsi_array": [float(v) for v in rsi_series.tolist()]
        }
        
        # rsi.py файлаас бусад утгуудыг MACD шиг нэгтгэж дуудна
        rsi_vals = calculate_rsi_values(klines, window=period)
        rsi_crs = calculate_rsi_cross(klines, window=period)
        rsi_sts = calculate_rsi_states(klines, window=period)
        rsi_trd = calculate_rsi_trend(klines, window=period)
        rsi_avg = calculate_rsi_average(klines, window=period)
        rsi_lst = calculate_rsi_laststatus(klines, window=period)

        return {
            "symbol": symbol,
            **rsi_arrays,
            **rsi_vals,
            **rsi_crs,
            **rsi_sts,
            **rsi_trd,
            **rsi_avg,
            **rsi_lst
        }
    except Exception as e:
        print(f"--- RSI ERROR FOR {symbol}: {str(e)} ---")
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))
        
# ==================== ARRAYS (MACD) ENDPOINT ====================
@app.get("/arrays/{symbol}")
def get_arrays_endpoint(
    symbol: str, 
    fast: int = Query(12), 
    slow: int = Query(26), 
    signal: int = Query(9)
):
    symbol = symbol.upper()
    if symbol not in kline_history or not kline_history[symbol]:
        raise HTTPException(status_code=400, detail="Kline data is empty or symbol not found")
    
    klines = kline_history[symbol]
    closes = [float(kline[4]) for kline in klines]
    close_series = pd.Series(closes)
    
    from ta.trend import MACD
    macd_indicator = MACD(
        close=close_series, 
        window_slow=int(slow), 
        window_fast=int(fast), 
        window_sign=int(signal)
    )
    
    return {
        "macd_line_array": [float(v) if pd.notna(v) else 0.0 for v in macd_indicator.macd().tolist()],
        "macd_signal_array": [float(v) if pd.notna(v) else 0.0 for v in macd_indicator.macd_signal().tolist()],
        "macd_histogram_array": [float(v) if pd.notna(v) else 0.0 for v in macd_indicator.macd_diff().tolist()]
    }

@app.get("/ohlc/{symbol}")
def get_symbol_ohlc(symbol: str):
    symbol = symbol.upper()
    with cache_lock:
        if symbol not in kline_history:
            raise HTTPException(status_code=404, detail="Symbol not found or not loaded yet")
        klines = kline_history[symbol]

    result = calculate_ohlc_tracker_report(klines, symbol)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return JSONResponse(content=jsonable_encoder(result))

@app.get("/ema/{span}/{symbol}")
def get_symbol_ema(span: int, symbol: str):
    symbol = symbol.upper()
    with cache_lock:
        if symbol not in kline_history:
            raise HTTPException(status_code=404, detail="Symbol not found or not loaded yet")
        klines = kline_history[symbol]

    result = calculate_ema_report(klines, symbol, span=span)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return JSONResponse(content=jsonable_encoder(result))

@app.get("/macd/{symbol}")
def get_symbol_macd(symbol: str):
    symbol = symbol.upper()
    with cache_lock:
        if symbol not in kline_history:
            raise HTTPException(status_code=404, detail="Symbol not found or not loaded yet")
        klines = kline_history[symbol]

    try:
        # arrays.py файлаас MACD массивыг татаж авна
        macd_arrays = calculate_macd_arrays(klines)
        
        # macd.py файлаас бусад утгуудыг дуудна
        macd_vals = calculate_macd_values(klines)
        macd_crs = calculate_macd_cross(klines)
        macd_sts = calculate_macd_state(klines)
        macd_trd = calculate_macd_trend(klines)
        macd_avg = calculate_macd_average(klines)
        macd_lim = calculate_macd_limits(klines)
        macd_init = calculate_macd_initial_crosses(klines)
        macd_pks = calculate_macd_peaks(klines)

        return {
            "symbol": symbol,
            **macd_arrays,
            **macd_vals,
            **macd_crs,
            **macd_sts,
            **macd_trd,
            **macd_avg,
            **macd_lim,
            **macd_init,
            **macd_pks
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    
@app.get("/top-movers")
def get_top_movers():
    global kline_history
    result = calculate_top_movers_report(kline_history, cache_lock)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return JSONResponse(content=jsonable_encoder(result))

# ==================== NEW MOVERS TRADING / TRACKING STATE ====================
new_movers_is_running = False
new_movers_lock = threading.Lock()

@app.get("/new-movers/start")
def start_new_movers():
    global new_movers_is_running
    with new_movers_lock:
        if new_movers_is_running:
            return {"status": "new-movers already running"}
        
        # macd_state.clear() гэснийг авч хаялаа. 
        # Ингэснээр өмнөх кросс хийсэн түүх болон initial_price устахгүй хадгалагдана.
        new_movers_is_running = True
        
    return {"status": "new-movers tracker started successfully, state preserved."}

@app.get("/new-movers/stop")
def stop_new_movers():
    global new_movers_is_running
    with new_movers_lock:
        if not new_movers_is_running:
            return {"status": "new-movers already stopped"}
        new_movers_is_running = False
    return {"status": "new-movers tracker stopped successfully."}

@app.get("/new-movers")
def get_new_movers():
    global new_movers_is_running
    with new_movers_lock:
        if not new_movers_is_running:
            return {"error": "New movers tracker is not running. Use /new-movers/start to begin."}
            
    global kline_history
    result = calculate_new_movers_report(kline_history, cache_lock, macd_state)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return JSONResponse(content=jsonable_encoder(result))

@app.get("/all/{symbol}")
def get_symbol_all_data(symbol: str):
    symbol = symbol.upper()
    with cache_lock:
        if symbol not in kline_history:
            raise HTTPException(status_code=404, detail="Symbol not found or not loaded yet")
        klines = kline_history[symbol]

    # Шинэчлэгдсэн RSI модулиудыг нэгтгэж дуудах
    try:
        rsi_vals = calculate_rsi_values(klines)
        rsi_crs = calculate_rsi_cross(klines)
        rsi_sts = calculate_rsi_states(klines)
        rsi_lst = calculate_rsi_laststatus(klines)
        rsi_trd = calculate_rsi_trend(klines)
        rsi_avg = calculate_rsi_average(klines)
        
        rsi_res = {
            "symbol": symbol,
            **rsi_vals,
            **rsi_crs,
            **rsi_sts,
            **rsi_lst,
            **rsi_trd,
            **rsi_avg
        }
    except Exception as e:
        rsi_res = {"error": str(e)}

    macd_res = calculate_macds(klines, symbol)
    ema13_res = calculate_ema_report(klines, symbol, span=13)
    ema50_res = calculate_ema_report(klines, symbol, span=50)
    ema200_res = calculate_ema_report(klines, symbol, span=200)
    ohlc_res = calculate_ohlc_tracker_report(klines, symbol)

    tops_res = None
    try:
        if symbol in calculate_macd_state:
            init_price = calculate_macd_state[symbol].get("macd_initial_up_price")
            if init_price and init_price > 0:
                close_price = float(klines[-1][4])
                change_percent = ((close_price - init_price) / init_price) * 100
                tops_res = {
                    "symbol": symbol,
                    "initial_price": round(init_price, 8),
                    "close_price": round(close_price, 8),
                    "change_percent": round(change_percent, 2)
                }
    except Exception:
        pass

    return JSONResponse(content=jsonable_encoder({
        "symbol": symbol,
        "rsi": rsi_res if "error" not in rsi_res else None,
        "macd": macd_res if "error" not in macd_res else None,
        "ema13": ema13_res if "error" not in ema13_res else None,
        "ema50": ema50_res if "error" not in ema50_res else None,
        "ema200": ema200_res if "error" not in ema200_res else None,
        "ohlc": ohlc_res if "error" not in ohlc_res else None,
        "tops": tops_res
    }))

@app.get("/candles")
def get_all_candles():
    with cache_lock:
        return kline_history

@app.get("/candles/{symbol}")
def get_symbol_candles(symbol: str):
    symbol = symbol.upper()
    with cache_lock:
        if symbol in kline_history:
            print("SERVER DATA CHECK:", kline_history[symbol][0])
            return {"symbol": symbol, "candles": kline_history[symbol]}
    raise HTTPException(status_code=404, detail="Symbol not found or not loaded yet")
    
@app.get("/binchart", response_class=HTMLResponse)
def get_binchart():
    try:
        with open("binchart.html", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="binchart.html файл олдсонгүй!")

@app.get("/backtest", response_class=HTMLResponse)
def backtest_page():
    try:
        with open("backtest.html", "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="backtest.html файл олдсонгүй!"
        )
    
@app.get("/price/{symbol}")
def get_symbol_live_price(symbol: str):
    symbol = symbol.upper()
    try:
        client = UMFutures()
        ticker = client.ticker_price(symbol=symbol)
        return {"symbol": symbol, "price": float(ticker["price"])}
    except Exception as e:
        return {"error": str(e)}
        
def get_active_symbols():
    try:
        client = UMFutures()
        client.session.requests_params = {"timeout": 10}
        info = client.exchange_info()
        return [s["symbol"] for s in info["symbols"] if s["quoteAsset"] == "USDT" and s["status"] == "TRADING" and s["contractType"] == "PERPETUAL"]
    except Exception as e:
        print(f"[ERROR] Failed to fetch symbols: {e}")
        return []

def fetch_historical_klines(client, symbol):
    for attempt in range(3):
        try:
            klines = client.klines(symbol=symbol, interval="1m", limit=MAX_KLINES)
            if not klines:
                return symbol, None
            return symbol, [[int(x[0]), float(x[1]), float(x[2]), float(x[3]), float(x[4]), float(x[5]), int(x[6])] for x in klines]
        except Exception as e:
            if attempt == 2:
                print(f"[ERROR] {symbol} failed: {e}")
            time.sleep(1)
    return symbol, None

def process_closed_kline(symbol, k):
    global closed_kline_count, last_kline_time
    new_kline = [int(k["t"]), float(k["o"]), float(k["h"]), float(k["l"]), float(k["c"]), float(k["v"]), int(k["T"])]
    
    with cache_lock:
        if symbol not in kline_history:
            kline_history[symbol] = []
        history = kline_history[symbol]
        
        if history and history[-1][0] == new_kline[0]:
            history[-1] = new_kline
        else:
            history.append(new_kline)
            
        if len(history) > MAX_KLINES:
            del history[:len(history) - MAX_KLINES]
            
        closed_kline_count += 1
        last_kline_time = time.time()
        
# ==================== WEBSOCKET ====================
def start_websocket(symbols):
    global ws_app, daemon_is_running
    print("\n" + "="*60 + "\nSTARTING REALTIME WEBSOCKET\n" + "="*60)
    print(f"[WS] Symbols: {len(symbols)} | URL: {WS_URL}")

    def on_open(ws):
        print("[WS] Connection opened successfully.")
        streams = [f"{s.lower()}@kline_1m" for s in symbols]
        print(f"[WS] Subscribing to {len(streams)} kline streams...")
        ws.send(json.dumps({"method": "SUBSCRIBE", "params": streams, "id": 1}))

    def on_message(ws, message):
        try:
            if isinstance(message, bytes):
                message = message.decode("utf-8")
            data = json.loads(message)
            
            if "result" in data:
                return
            if "data" in data:
                data = data["data"]
            if data.get("e") != "kline":
                return
                
            symbol, kline = data.get("s"), data.get("k")
            if symbol and kline:
                process_closed_kline(symbol, kline)
        except Exception as e:
            print(f"[WS MESSAGE ERROR] {e}")

    def on_error(ws, error):
        print(f"[WS ERROR] {error}")

    def on_close(ws, code, message):
        print(f"[WS CLOSED] code={code}, message={message}")

    while daemon_is_running:
        try:
            print("[WS] Connecting...")
            ws_app = websocket.WebSocketApp(WS_URL, on_open=on_open, on_message=on_message, on_error=on_error, on_close=on_close)
            ws_app.run_forever(ping_interval=WS_PING_INTERVAL, ping_timeout=WS_PING_TIMEOUT)
        except Exception as e:
            print(f"[WS EXCEPTION] {e}")
        
        if daemon_is_running:
            print("[WS] Reconnecting in 5 seconds...")
            time.sleep(5)

# ==================== MONITOR ====================
def status_monitor():
    global closed_kline_count, last_kline_time, daemon_is_running
    while daemon_is_running:
        time.sleep(10)
        with cache_lock:
            count, symbols_loaded = closed_kline_count, len(kline_history)
            total_candles = sum(len(x) for x in kline_history.values())
        age = "NO CANDLES YET" if last_kline_time == 0 else f"{time.time() - last_kline_time:.1f}s ago"
        print(f"[STATUS] Symbols: {symbols_loaded} | Candles in RAM: {total_candles:,} | Updates: {count} | Last: {age}")

# ==================== BACKGROUND DAEMON INIT ====================
def start_background_daemon():
    global kline_history, daemon_is_running
    print("="*60 + "\nBINANCE 1M CANDLE BASE DATA DAEMON\n" + "="*60)
    
    print("[INFO] Fetching active USDT perpetual symbols...")
    symbols = get_active_symbols()
    if not symbols or not daemon_is_running:
        print("[ERROR] No active symbols found or daemon stopped.")
        daemon_is_running = False
        return

    print(f"[SUCCESS] Found {len(symbols)} active symbols.")
    print("\n" + "="*60 + "\nONE-TIME HISTORICAL DOWNLOAD (TURBO MODE)\n" + "="*60)

    client = UMFutures()
    client.session.requests_params = {"timeout": 10}
    loaded_count = 0
    failed_symbols = []
    progress_lock = threading.Lock()

    def worker(symbol):
        nonlocal loaded_count
        if not daemon_is_running:
            return symbol, None
        
        # Завсарлагыг 0.3 секунд болгож сунгав (Бинансын weight limit-д хэт ачаалал өгөхгүй)
        time.sleep(0.3) 
        
        res_sym, hist = fetch_historical_klines(client, symbol)
        with progress_lock:
            loaded_count += 1
            print(f"\r[LOADING] {loaded_count}/{len(symbols)} - {symbol}", end="", flush=True)
        return res_sym, hist

    start_time = time.time()
    
    # Урсгалын тоог 5 болгон багасгаж илүү тогтвортой болгов
    TURBO_WORKERS = 5
    
    # Урсгалын тоог 10 болгож өсгөв (Турбо горим)
    TURBO_WORKERS = 10 
    with ThreadPoolExecutor(max_workers=TURBO_WORKERS) as executor:
        futures = [executor.submit(worker, s) for s in symbols]
        for f in as_completed(futures):
            if not daemon_is_running:
                break
            sym, hist = f.result()
            if hist:
                with cache_lock:
                    kline_history[sym] = hist
            else:
                failed_symbols.append(sym)

    if not daemon_is_running:
        print("\n🛑 [STOP] Daemon was stopped during download.")
        return

    print(f"\n[SUCCESS] Download finished in {time.time() - start_time:.1f}s. Loaded: {len(kline_history)}/{len(symbols)}")
    
    threading.Thread(target=status_monitor, daemon=True).start()
    start_websocket(symbols)
    
# ==================== ENTRY POINT ====================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

# ==========================================
# GOLD DATA ENDPOINTS (Файлын яг хамгийн доор тавина)
# ==========================================

market_quotes = {}
market_candle_quotes = {}

@app.post("/api/gold-update")
def receive_gold_candles(data: dict):
    global market_quotes, market_candle_quotes
    symbol = data.get("symbol", "GOLD").upper()
    candles = data.get("candles", [])
    ask_price = data.get("ask", 0.0)
    bid_price = data.get("bid", 0.0)
    full_snapshot = bool(data.get("full_snapshot", True))
    
    if not candles:
        raise HTTPException(status_code=400, detail="Candles data is empty")

    try:
        formatted_candles = []
        formatted_quotes = {}
        for x in candles:
            raw_time = int(x["open_time"])
            t = raw_time * 1000 if raw_time < 10000000000 else raw_time
            
            formatted_candles.append([
                t, float(x["open"]), float(x["high"]), 
                float(x["low"]), float(x["close"]), float(x["volume"]), t
            ])
            if x.get("bid") is not None and x.get("ask") is not None:
                formatted_quotes[t] = {
                    "bid": float(x["bid"]),
                    "ask": float(x["ask"]),
                }

        needs_full_snapshot = False
        with cache_lock:
            existing_candles = kline_history.get(symbol, [])
            existing_quotes = market_candle_quotes.get(symbol, {})

            if full_snapshot or not existing_candles:
                merged_candles = formatted_candles
                merged_quotes = formatted_quotes
                needs_full_snapshot = not full_snapshot and not existing_candles
            else:
                merged_candles = list(existing_candles)
                merged_quotes = dict(existing_quotes)
                latest_time = int(merged_candles[-1][0]) if merged_candles else None

                for candle in formatted_candles:
                    candle_time = int(candle[0])
                    if latest_time is None or candle_time > latest_time:
                        merged_candles.append(candle)
                        latest_time = candle_time
                    elif candle_time == latest_time:
                        merged_candles[-1] = candle
                    else:
                        continue

                    quote = formatted_quotes.get(candle_time)
                    if quote is not None:
                        merged_quotes[candle_time] = quote

                overflow = len(merged_candles) - MAX_GOLD_CANDLES
                if overflow > 0:
                    removed_times = {int(candle[0]) for candle in merged_candles[:overflow]}
                    merged_candles = merged_candles[overflow:]
                    for candle_time in removed_times:
                        merged_quotes.pop(candle_time, None)

            kline_history[symbol] = merged_candles
            market_candle_quotes[symbol] = merged_quotes
            market_quotes[symbol] = {
                "ask": ask_price,
                "bid": bid_price
            }
            
        print(f"[GOLD UPDATE] Successfully loaded {len(formatted_candles)} candles for {symbol} | Ask: {ask_price}, Bid: {bid_price}")
        return {
            "status": "success", 
            "symbol": symbol, 
            "loaded_candles": len(formatted_candles),
            "ask": ask_price,
            "bid": bid_price,
            "stored_candles": len(kline_history[symbol]),
            "needs_full_snapshot": needs_full_snapshot
        }
    except Exception as e:
        print(f"[GOLD ERROR] Failed to process gold candles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/gold")
def get_gold_for_backtest():
    with cache_lock:
        if "GOLD" not in kline_history:
            raise HTTPException(
                status_code=404,
                detail="GOLD candle data not loaded"
            )

        rows = list(kline_history["GOLD"])

        quote = dict(
            market_quotes.get(
                "GOLD",
                {
                    "ask": 0.0,
                    "bid": 0.0
                }
            )
        )
        candle_quotes = dict(market_candle_quotes.get("GOLD", {}))

    try:
        macd_data = calculate_macd_arrays(rows)
        macd_line_array = macd_data.get("macd_line_array", [])
        macd_signal_array = macd_data.get("macd_signal_array", [])
        macd_histogram_array = macd_data.get("macd_histogram_array", [])

        rsi_array = calculate_rsi_array(rows, window=7)
        if not isinstance(rsi_array, list):
            rsi_array = []

        candles = []

        for i, row in enumerate(rows):
            candle_close = float(row[4])
            candle_quote = candle_quotes.get(int(row[0]), {})
            
            candles.append({
                "open_time": float(row[0]),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": candle_close,
                "volume": float(row[5]),

                "rsi": (
                    float(rsi_array[i])
                    if i < len(rsi_array) and rsi_array[i] is not None
                    else None
                ),
                "macd_line": (
                    float(macd_line_array[i])
                    if i < len(macd_line_array) and macd_line_array[i] is not None
                    else None
                ),
                "macd_signal": (
                    float(macd_signal_array[i])
                    if i < len(macd_signal_array) and macd_signal_array[i] is not None
                    else None
                ),
                "macd_histogram": (
                    float(macd_histogram_array[i])
                    if i < len(macd_histogram_array) and macd_histogram_array[i] is not None
                    else None
                ),

                "bid": float(candle_quote.get("bid", candle_close)),
                "ask": float(candle_quote.get("ask", candle_close))
            })

        return {
            "symbol": "GOLD",
            "timeframe": "1m",
            "count": len(candles),
            "bid": float(quote.get("bid", 0.0)),
            "ask": float(quote.get("ask", 0.0)),
            "candles": candles
        }

    except Exception as e:
        print(f"[GOLD API ERROR] {e}")
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
