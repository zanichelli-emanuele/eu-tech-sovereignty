#!/usr/bin/env python3
"""
fetch_data.py — price pipeline for the EU Tech Sovereignty Universe dashboard.

Re-runnable. For every LISTED company in data/companies.json it pulls ~5 years of
daily adjusted closing prices (yfinance primary, stooq.com CSV fallback), normalises
to EUR using EUR-cross FX history, and writes data/prices/<id>.json.

Guarantees:
- Never overwrites a good cached file with an empty/failed result (the dashboard can
  always render from whatever prices/*.json already exist).
- Private companies are skipped (no chart in the UI).
- Logs which fetches succeeded / failed / were served from cache, with as_of dates.

Usage:  python3 fetch_data.py            # refresh all
        python3 fetch_data.py asml ifx   # refresh only these ids
No paid API keys required.
"""
import csv, io, json, os, sys, time, urllib.request, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
COMPANIES = os.path.join(ROOT, "data", "companies.json")
PRICES_DIR = os.path.join(ROOT, "data", "prices")
YEARS = 5

try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    sys.exit("Install deps:  pip install yfinance pandas --break-system-packages")

# ---- currency handling ---------------------------------------------------
# price currency by Yahoo suffix / symbol; .L quotes in pence (GBp -> /100)
FX_SYMBOL = {"USD": "EURUSD=X", "GBP": "EURGBP=X", "SEK": "EURSEK=X", "NOK": "EURNOK=X"}
_fx_cache = {}

def price_currency(yt):
    if yt.endswith(".L"):       return "GBp"   # pence
    if yt.endswith(".ST"):      return "SEK"
    if yt.endswith(".OL"):      return "NOK"
    if yt.endswith(".SW"):      return "CHF"
    if "." not in yt:           return "USD"   # e.g. NXPI on Nasdaq
    return "EUR"                                # .AS .PA .DE .MI .MC .HE .BR ...

def fx_series(ccy):
    """EUR->ccy daily series (pandas Series), cached. None for EUR."""
    if ccy in ("EUR", None):
        return None
    sym = FX_SYMBOL.get(ccy)
    if not sym:
        return None
    if sym not in _fx_cache:
        try:
            s = yf.Ticker(sym).history(period=f"{YEARS}y")["Close"]
            s.index = s.index.tz_localize(None)
            _fx_cache[sym] = s
        except Exception as e:
            print(f"    ! FX {sym} failed: {e}")
            _fx_cache[sym] = None
    return _fx_cache[sym]

def to_eur(close_series, ccy):
    """Convert a price Series (indexed by date) to EUR using per-date FX (ffill)."""
    if ccy == "GBp":
        close_series = close_series / 100.0
        ccy = "GBP"
    if ccy == "EUR":
        return close_series, "native EUR"
    fx = fx_series(ccy)
    if fx is None or fx.empty:
        return None, f"no FX for {ccy}"
    aligned = fx.reindex(close_series.index.union(fx.index)).sort_index().ffill().bfill().reindex(close_series.index)
    eur = close_series / aligned   # EUR = local / (EUR->local)
    return eur, f"{ccy}->EUR via {FX_SYMBOL[ccy]} (per-date, ffill)"

# ---- fetchers ------------------------------------------------------------
def fetch_yf(yt):
    try:
        h = yf.Ticker(yt).history(period=f"{YEARS}y", interval="1d", auto_adjust=True)
        if h is None or h.empty:
            return None
        s = h["Close"].dropna()
        s.index = s.index.tz_localize(None)
        return s
    except Exception as e:
        print(f"    ! yfinance {yt}: {e}")
        return None

STOOQ_SUFFIX = {"": ".US"}  # best-effort; reliable mainly for US tickers
def fetch_stooq(yt):
    # crude Yahoo->stooq symbol guess; only attempt where plausible
    sym = None
    if "." not in yt:
        sym = (yt + ".US").lower()
    if sym is None:
        return None
    url = f"https://stooq.com/q/d/l/?s={sym}&i=d"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            txt = r.read().decode("utf-8", "replace")
        rows = list(csv.DictReader(io.StringIO(txt)))
        if not rows or "Date" not in rows[0]:
            return None
        idx = pd.to_datetime([x["Date"] for x in rows])
        vals = pd.to_numeric([x["Close"] for x in rows], errors="coerce")
        s = pd.Series(vals, index=idx).dropna()
        cutoff = pd.Timestamp.today() - pd.Timedelta(days=365 * YEARS)
        return s[s.index >= cutoff]
    except Exception as e:
        print(f"    ! stooq {sym}: {e}")
        return None

def write_prices(comp, eur_series, source, fx_note):
    pts = [{"date": d.strftime("%Y-%m-%d"), "close": round(float(v), 4)}
           for d, v in eur_series.items() if pd.notna(v)]
    if not pts:
        return False
    out = {
        "id": comp["id"], "name": comp["name"], "ticker": comp["yahoo_ticker"],
        "currency": "EUR", "source": source, "fx_note": fx_note,
        "as_of": pts[-1]["date"], "n": len(pts), "prices": pts,
    }
    os.makedirs(PRICES_DIR, exist_ok=True)
    with open(os.path.join(PRICES_DIR, comp["id"] + ".json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    return True

# ---- main ----------------------------------------------------------------
def main():
    only = set(a.lower() for a in sys.argv[1:])
    companies = json.load(open(COMPANIES))["companies"]
    listed = [c for c in companies if c.get("is_listed") and c.get("yahoo_ticker")]
    if only:
        listed = [c for c in listed if c["id"] in only]
    ok = fail = cached = 0
    print(f"Fetching ~{YEARS}y daily closes for {len(listed)} listed companies -> EUR\n")
    for c in listed:
        yt = c["yahoo_ticker"]; ccy = price_currency(yt)
        print(f"  {c['id']:22} {yt:12} [{ccy}]", end="  ")
        s = fetch_yf(yt)
        src = "yfinance"
        if s is None or s.empty:
            s = fetch_stooq(yt); src = "stooq"
        if s is None or s.empty:
            existing = os.path.join(PRICES_DIR, c["id"] + ".json")
            if os.path.exists(existing):
                print("FAILED -> kept existing cache"); cached += 1
            else:
                print("FAILED -> no data, no cache"); fail += 1
            continue
        eur, note = to_eur(s, ccy)
        if eur is None:
            print(f"FAILED conversion ({note})"); fail += 1; continue
        if write_prices(c, eur, src, note):
            print(f"ok  {src:8} {len(eur)} pts  as_of {eur.index[-1].strftime('%Y-%m-%d')}  ({note})"); ok += 1
        else:
            print("FAILED -> empty after convert"); fail += 1
        time.sleep(0.4)  # be gentle
    print(f"\nDone. ok={ok}  served-from-cache={cached}  failed={fail}  ({datetime.date.today()})")
    skipped = [c['id'] for c in companies if not (c.get('is_listed') and c.get('yahoo_ticker'))]
    print(f"Private/no-ticker (no price chart): {len(skipped)} -> {', '.join(skipped)}")

if __name__ == "__main__":
    main()
