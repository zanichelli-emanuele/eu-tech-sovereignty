#!/usr/bin/env python3
"""Static dev server (no-store) + LIVE market data for the terminal.

Endpoints:
  GET /api/quote?t=ASML.AS  -> {"price_eur":..,"change_pct":..,"market_cap_eur":..,"currency":..,"ts":..}
  GET /api/snapshot         -> {"as_of":iso,"ts":int,"n":int,"quotes":{id:{price_eur,change_pct,market_cap_eur,currency,ts}}}

A background thread refreshes a FULL snapshot (price + market cap, EUR-normalised) for every
listed company in data/companies.json every REFRESH_SEC seconds and persists it to
data/live_snapshot.json. The page reads /api/snapshot on load (and on tab-focus), so the
numbers are fresh the moment you open it — no manual fetch. companies.json is re-read each
cycle, so companies you add are picked up without a restart. Yahoo data is ~15-min delayed.

Usage:  python3 serve.py [port]   (default 8000)
"""
import http.server, socketserver, os, sys, json, time, threading, datetime, urllib.parse
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
REFRESH_SEC = 600                       # full-universe snapshot cadence (10 min)
SNAP_FILE = os.path.join("data", "live_snapshot.json")
COMPANIES = os.path.join("data", "companies.json")
try:
    import yfinance as yf
except ImportError:
    yf = None

_FX, _Q = {}, {}                        # caches: ccy->(ts,rate) ; sym->(ts,data)
_SNAP, _SNAP_TS = {}, 0                 # id -> {price_eur,change_pct,market_cap_eur,currency,ts}
FXSYM = {"USD":"EURUSD=X","NOK":"EURNOK=X","GBP":"EURGBP=X","CHF":"EURCHF=X","SEK":"EURSEK=X","DKK":"EURDKK=X"}

def _iso(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat() if ts else None

def fx(ccy):
    if ccy in ("EUR", None): return 1.0
    sym = FXSYM.get(ccy)
    if not sym: return 1.0
    now = time.time()
    if sym in _FX and now-_FX[sym][0] < 3600: return _FX[sym][1]
    try:
        r = float(yf.Ticker(sym).fast_info.last_price); _FX[sym] = (now, r); return r
    except Exception:
        return _FX.get(sym, (0, 1.0))[1]

def _fields(sym):
    """(price_eur, change_pct, market_cap_eur, currency) from one fast_info call; Nones on miss.
    Price AND market cap are in the quote currency; LSE (.L) quotes both in pence (GBp)."""
    fi = yf.Ticker(sym).fast_info
    last = getattr(fi, "last_price", None) or getattr(fi, "previous_close", None)
    prev = getattr(fi, "previous_close", None)
    cur  = getattr(fi, "currency", None) or "EUR"
    mc   = getattr(fi, "market_cap", None)
    def eur(v):
        if v is None: return None
        return v/100.0/fx("GBP") if cur == "GBp" else v/fx(cur)
    price_eur  = round(eur(last), 4) if last else None
    change_pct = round((last/prev-1)*100, 2) if (last and prev) else None
    mc_eur     = round(eur(mc)) if mc else None
    return price_eur, change_pct, mc_eur, cur

def quote(sym):
    now = time.time()
    if sym in _Q and now-_Q[sym][0] < 20: return _Q[sym][1]
    if yf is None: return {"error": "yfinance not installed"}
    try:
        p, ch, mc, cur = _fields(sym)
        data = {"price_eur": p, "change_pct": ch, "market_cap_eur": mc, "currency": cur, "ts": int(now)}
    except Exception as e:
        data = {"error": str(e)}
    _Q[sym] = (now, data); return data

def build_snapshot():
    """Refresh price + market cap for every listed company; merge over last-good values."""
    global _SNAP, _SNAP_TS
    if yf is None: return
    try:
        companies = json.load(open(COMPANIES))["companies"]
    except Exception as e:
        print("snapshot: cannot read companies.json:", e); return
    listed = [c for c in companies if c.get("is_listed") and c.get("yahoo_ticker")]
    snap = dict(_SNAP)                  # keep last-good; only overwrite what succeeds this cycle
    ok = 0
    for c in listed:
        try:
            p, ch, mc, cur = _fields(c["yahoo_ticker"])
            if p is None and mc is None: continue
            snap[c["id"]] = {"price_eur": p, "change_pct": ch, "market_cap_eur": mc,
                             "currency": cur, "ts": int(time.time())}
            ok += 1
        except Exception:
            pass
        time.sleep(0.12)               # be gentle with Yahoo
    _SNAP, _SNAP_TS = snap, int(time.time())
    try:
        os.makedirs("data", exist_ok=True)
        json.dump({"as_of": _iso(_SNAP_TS), "ts": _SNAP_TS, "n": len(snap), "quotes": snap},
                  open(SNAP_FILE, "w"), separators=(",", ":"))
    except Exception as e:
        print("snapshot: write failed:", e)
    print(f"snapshot: {ok}/{len(listed)} live  ({datetime.datetime.now().strftime('%H:%M:%S')})")

def refresh_loop():
    while True:
        build_snapshot()
        time.sleep(REFRESH_SEC)

# seed from last persisted snapshot so the very first page open has data before cycle 1 finishes
try:
    _j = json.load(open(SNAP_FILE)); _SNAP = _j.get("quotes", {}); _SNAP_TS = _j.get("ts", 0)
except Exception:
    pass

class Handler(http.server.SimpleHTTPRequestHandler):
    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path.startswith("/api/quote"):
            t = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("t", [""])[0]
            return self._json(quote(t) if t else {"error": "missing t"})
        if self.path.startswith("/api/snapshot"):
            return self._json({"as_of": _iso(_SNAP_TS), "ts": _SNAP_TS, "n": len(_SNAP), "quotes": _SNAP})
        super().do_GET()
    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()
    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
if yf is not None:
    threading.Thread(target=refresh_loop, daemon=True).start()
else:
    print("! yfinance not installed — serving static snapshot only (no live refresh)")
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"serving {os.getcwd()} on http://localhost:{PORT}  (+ /api/quote, /api/snapshot; refresh {REFRESH_SEC}s)")
    httpd.serve_forever()
