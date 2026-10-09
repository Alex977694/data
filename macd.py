import datetime

import pandas as pd


def _format_time_gmt8(timestamp):
    gmt8 = datetime.timezone(datetime.timedelta(hours=8))
    return datetime.datetime.fromtimestamp(
        float(timestamp) / 1000.0,
        gmt8,
    ).strftime("%Y-%m-%d %H:%M:%S")


def _calculate_macd_series(klines, fast=12, slow=26, signal=9):
    """Нэгдсэн байдлаар MACD цувааг тооцоолох туслах функц."""
    if not klines:
        raise ValueError("Kline data is empty")
    closes = pd.Series([float(kline[4]) for kline in klines])
    fast_ema = closes.ewm(span=int(fast), adjust=False).mean()
    slow_ema = closes.ewm(span=int(slow), adjust=False).mean()
    macd_line = fast_ema - slow_ema
    macd_signal = macd_line.ewm(span=int(signal), adjust=False).mean()
    return macd_line, macd_signal, macd_line - macd_signal


# ==================== MACD VALUES ====================
def calculate_macd_values(klines, fast=12, slow=26, signal=9):
    macd_line, macd_signal, macd_histogram = _calculate_macd_series(klines, fast, slow, signal)
    if len(macd_line) < 5:
        raise ValueError("At least five MACD values are required")
    return {
        "latest_macd_line": f"{macd_line.iloc[-1]:.8f}",
        "previous_macd_line": f"{macd_line.iloc[-2]:.8f}",
        "previous_2_macd_line": f"{macd_line.iloc[-3]:.8f}",
        "previous_3_macd_line": f"{macd_line.iloc[-4]:.8f}",
        "previous_4_macd_line": f"{macd_line.iloc[-5]:.8f}",
        "latest_macd_signal": f"{macd_signal.iloc[-1]:.8f}",
        "previous_macd_signal": f"{macd_signal.iloc[-2]:.8f}",
        "previous_2_macd_signal": f"{macd_signal.iloc[-3]:.8f}",
        "previous_3_macd_signal": f"{macd_signal.iloc[-4]:.8f}",
        "previous_4_macd_signal": f"{macd_signal.iloc[-5]:.8f}",
        "latest_macd_histogram": f"{macd_histogram.iloc[-1]:.8f}",
        "previous_macd_histogram": f"{macd_histogram.iloc[-2]:.8f}",
        "previous_2_macd_histogram": f"{macd_histogram.iloc[-3]:.8f}",
        "previous_3_macd_histogram": f"{macd_histogram.iloc[-4]:.8f}",
        "previous_4_macd_histogram": f"{macd_histogram.iloc[-5]:.8f}",
    }


# ==================== MACD CROSS ====================
def calculate_macd_cross(klines, fast=12, slow=26, signal=9):
    macd_line, macd_signal, _ = _calculate_macd_series(klines, fast, slow, signal)
    if len(macd_line) < 3:
        raise ValueError("At least three MACD values are required")
    previous_macd_line = macd_line.iloc[-2]
    previous_2_macd_line = macd_line.iloc[-3]
    previous_macd_signal = macd_signal.iloc[-2]
    previous_2_macd_signal = macd_signal.iloc[-3]
    return {
        "macd_upcross": bool(
            previous_2_macd_line <= previous_2_macd_signal
            and previous_macd_line > previous_macd_signal
        ),
        "macd_downcross": bool(
            previous_2_macd_line >= previous_2_macd_signal
            and previous_macd_line < previous_macd_signal
        ),
    }


# ==================== MACD STATE ====================
def calculate_macd_state(klines, fast=12, slow=26, signal=9):
    macd_line, macd_signal, _ = _calculate_macd_series(klines, fast, slow, signal)
    previous_macd_line = macd_line.iloc[-2]
    previous_macd_signal = macd_signal.iloc[-2]
    return {
        "macd_line_up": bool(previous_macd_line > 0),
        "macd_line_down": bool(previous_macd_line < 0),
        "macd_up": bool(previous_macd_line > previous_macd_signal),
        "macd_down": bool(previous_macd_line < previous_macd_signal),
    }


# ==================== MACD TREND ====================
def calculate_macd_trend(klines, fast=12, slow=26, signal=9):
    macd_line, macd_signal, _ = _calculate_macd_series(klines, fast, slow, signal)
    if len(macd_line) < 3:
        raise ValueError("At least three MACD values are required")
    trend = "None"
    for index in range(len(macd_line) - 2, 0, -1):
        if macd_line.iloc[index - 1] <= macd_signal.iloc[index - 1] and macd_line.iloc[index] > macd_signal.iloc[index]:
            trend = "UP"
            break
        if macd_line.iloc[index - 1] >= macd_signal.iloc[index - 1] and macd_line.iloc[index] < macd_signal.iloc[index]:
            trend = "DOWN"
            break
    return {"macd_trend": trend}


# ==================== MACD PEAKS ====================
def calculate_macd_peaks(klines, fast=12, slow=26, signal=9):
    """Return the last completed extrema and the currently forming extremum."""
    macd_line, _, _ = _calculate_macd_series(klines, fast, slow, signal)
    offset = len(klines) - len(macd_line)

    def point_at(index):
        kline_index = index + offset
        if not 0 <= kline_index < len(klines):
            return None
        return {
            "macd_value": float(macd_line.iloc[index]),
            "price": float(klines[kline_index][1]),
            "time": _format_time_gmt8(klines[kline_index][0]),
        }

    macd_peak = {"macd_value": 0.0, "price": 0.0}
    macd_trough = {"macd_value": 0.0, "price": 0.0}
    active_peak = None
    active_trough = None
    last_peak = None
    last_trough = None
    closed_length = max(0, len(macd_line) - 1)

    for index in range(closed_length):
        value = float(macd_line.iloc[index])
        previous = float(macd_line.iloc[index - 1]) if index else 0.0
        point = point_at(index)

        if previous >= 0 and value < 0:
            if active_peak is not None:
                macd_peak = {key: active_peak[key] for key in ("macd_value", "price")}
            active_peak = None
            active_trough = point
        elif previous <= 0 and value > 0:
            if active_trough is not None:
                macd_trough = {key: active_trough[key] for key in ("macd_value", "price")}
            active_trough = None
            active_peak = point
        elif value > 0:
            if active_peak is None or point["macd_value"] > active_peak["macd_value"]:
                active_peak = point
        elif value < 0:
            if active_trough is None or point["macd_value"] < active_trough["macd_value"]:
                active_trough = point

    latest_closed = float(macd_line.iloc[-2]) if len(macd_line) > 1 else None
    if latest_closed is not None and latest_closed > 0:
        last_peak = active_peak
    elif latest_closed is not None and latest_closed < 0:
        last_trough = active_trough

    return {
        "macd_peak": macd_peak,
        "macd_trough": macd_trough,
        "last_peak": last_peak,
        "last_trough": last_trough,
    }


# ==================== MACD AVERAGE ====================
def calculate_macd_average(klines, fast=12, slow=26, signal=9):
    macd_line, _, _ = _calculate_macd_series(klines, fast, slow, signal)
    if len(macd_line) < 4:
        raise ValueError("At least four MACD values are required")
    values = [float(value) for value in macd_line.iloc[-5:-1]]
    peaks = calculate_macd_peaks(klines, fast, slow, signal)
    peak_value = peaks["macd_peak"]["macd_value"]
    trough_value = peaks["macd_trough"]["macd_value"]
    return {
        "macd_min": f"{min(values):.8f}",
        "macd_max": f"{max(values):.8f}",
        "macd_average": f"{(peak_value + trough_value) / 2.0:.8f}",
    }


# ==================== MACD LIMITS ====================
def calculate_macd_limits(klines, fast=12, slow=26, signal=9):
    """Return the latest MACD/signal cross limits from closed candles."""
    macd_line, macd_signal, _ = _calculate_macd_series(klines, fast, slow, signal)
    if len(macd_line) < 5:
        raise ValueError("At least five MACD values are required")

    up_limit = None
    down_limit = None
    up_cross_line = None
    down_cross_line = None
    for index in range(len(macd_line) - 2, 2, -1):
        previous_macd_line = macd_line.iloc[index]
        previous_2_macd_line = macd_line.iloc[index - 1]
        previous_macd_signal = macd_signal.iloc[index]
        previous_2_macd_signal = macd_signal.iloc[index - 1]
        window = macd_line.iloc[index - 3 : index + 1]

        if up_limit is None and previous_macd_line > previous_macd_signal and previous_2_macd_line < previous_2_macd_signal:
            up_limit = float(min(window))
            up_cross_line = float(previous_macd_line)
        if down_limit is None and previous_macd_line < previous_macd_signal and previous_2_macd_line > previous_2_macd_signal:
            down_limit = float(max(window))
            down_cross_line = float(previous_macd_line)
        if up_limit is not None and down_limit is not None:
            break

    return {
        "macd_uplimit": up_limit,
        "macd_downlimit": down_limit,
        "uplimit_cross_line": up_cross_line,
        "downlimit_cross_line": down_cross_line,
    }


# ==================== MACD INITIAL CROSSES ====================
def calculate_macd_initial_crosses(klines, fast=12, slow=26, signal=9):
    """Return initial zero-line crosses for MACD line and signal line."""
    macd_line, macd_signal, _ = _calculate_macd_series(klines, fast, slow, signal)
    offset = len(klines) - len(macd_line)
    macd_initial_up = None
    macd_initial_down = None
    signal_initial_up = None
    signal_initial_down = None

    for index in range(len(macd_line) - 2, 0, -1):
        previous_macd_line = macd_line.iloc[index]
        previous_2_macd_line = macd_line.iloc[index - 1]
        previous_macd_signal = macd_signal.iloc[index]
        previous_2_macd_signal = macd_signal.iloc[index - 1]
        kline_index = index + offset
        if not 0 <= kline_index < len(klines):
            continue

        item = {
            "price": float(klines[kline_index][1]),
            "time": _format_time_gmt8(klines[kline_index][0]),
        }
        if macd_initial_up is None and previous_2_macd_line < 0 and previous_macd_line > 0:
            macd_initial_up = item
        if macd_initial_down is None and previous_2_macd_line > 0 and previous_macd_line < 0:
            macd_initial_down = item
        if signal_initial_up is None and previous_2_macd_signal < 0 and previous_macd_signal > 0:
            signal_initial_up = item
        if signal_initial_down is None and previous_2_macd_signal > 0 and previous_macd_signal < 0:
            signal_initial_down = item
        if all(value is not None for value in [
            macd_initial_up,
            macd_initial_down,
            signal_initial_up,
            signal_initial_down,
        ]):
            break

    return {
        "macd_initial_up_price": macd_initial_up["price"] if macd_initial_up else None,
        "macd_initial_up_time": macd_initial_up["time"] if macd_initial_up else None,
        "macd_initial_down_price": macd_initial_down["price"] if macd_initial_down else None,
        "macd_initial_down_time": macd_initial_down["time"] if macd_initial_down else None,
        "signal_initial_up_price": signal_initial_up["price"] if signal_initial_up else None,
        "signal_initial_up_time": signal_initial_up["time"] if signal_initial_up else None,
        "signal_initial_down_price": signal_initial_down["price"] if signal_initial_down else None,
        "signal_initial_down_time": signal_initial_down["time"] if signal_initial_down else None,
    }


# ==================== ALL MACD INDICATORS (WRAPPER) ====================
def calculate_all_macd_indicators(klines, fast=12, slow=26, signal=9):
    """Бүх MACD индикаторуудыг тохируулсан утгаар нэг дор тооцоолох функц."""
    return {
        **calculate_macd_values(klines, fast, slow, signal),
        **calculate_macd_cross(klines, fast, slow, signal),
        **calculate_macd_state(klines, fast, slow, signal),
        **calculate_macd_trend(klines, fast, slow, signal),
        **calculate_macd_average(klines, fast, slow, signal),
        **calculate_macd_limits(klines, fast, slow, signal),
        **calculate_macd_initial_crosses(klines, fast, slow, signal),
        **calculate_macd_peaks(klines, fast, slow, signal),
    }


__all__ = [
    "calculate_macd_values",
    "calculate_macd_cross",
    "calculate_macd_state",
    "calculate_macd_trend",
    "calculate_macd_average",
    "calculate_macd_limits",
    "calculate_macd_initial_crosses",
    "calculate_macd_peaks",
    "calculate_all_macd_indicators",
]
