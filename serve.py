#!/usr/bin/env python3
"""Static dev server (no-store) + a tiny LIVE-quote API for the terminal.

  GET /api/quote?t=ASML.AS  ->  {"price_eur":..,"change_pct":..,"currency":..,"ts":..}

Quotes are fetched server-side with yfinance (so the browser avoids CORS) and cached ~20s.
Yahoo data is ~15-minutes delayed. Static files are served with no-store so the UI never
goes stale while iterating. Usage:  python3 serve.py [port]   (default 8000)
"""
import http.server, socketserver, os, sys, json, time, urllib.parse
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
try:
    import yfinance as yf
except ImportError:
    yf = None

_FX, _Q = {}, {}                      # caches: ccy->(ts,rate) ; sym->(ts,data)
FXSYM = {"USD":"EURUSD=X","NOK":"EURNOK=X","GBP":"EURGBP=X","CHF":"EURCHF=X","SEK":"EURSEK=X","DKK":"EURDKK=X"}

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

def quote(sym):
    now = time.time()
    if sym in _Q and now-_Q[sym][0] < 20: return _Q[sym][1]
    if yf is None: return {"error": "yfinance not installed"}
    try:
        fi = yf.Ticker(sym).fast_info
        last = getattr(fi, "last_price", None) or getattr(fi, "previous_close", None)
        prev = getattr(fi, "previous_close", None)
        cur = getattr(fi, "currency", None) or "EUR"
        if cur == "GBp" and last:  last, prev, cur = last/100.0, (prev or 0)/100.0, "GBP"
        rate = fx(cur)
        data = {"price_eur": round(last/rate, 4) if last else None,
                "change_pct": round((last/prev-1)*100, 2) if (last and prev) else None,
                "currency": cur, "ts": int(now)}
    except Exception as e:
        data = {"error": str(e)}
    _Q[sym] = (now, data); return data

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/quote"):
            t = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("t", [""])[0]
            body = json.dumps(quote(t) if t else {"error": "missing t"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers(); self.wfile.write(body); return
        super().do_GET()
    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()
    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"serving {os.getcwd()} (+ /api/quote live) on http://localhost:{PORT}")
    httpd.serve_forever()
