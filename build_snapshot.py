#!/usr/bin/env python3
"""build_snapshot.py — one-shot live snapshot for the terminal (price + market cap, EUR).

For every listed company in data/companies.json, pull last price, previous close and market
cap via yfinance fast_info, normalise to EUR, and write data/live_snapshot.json:

  {"as_of": iso, "ts": int, "n": int, "quotes": {id: {price_eur, change_pct, market_cap_eur, currency, ts}}}

This is what the page reads on GitHub Pages (where there is no live server). The GitHub Action
runs it on a schedule and commits the refreshed file. Locally, serve.py serves an equivalent
snapshot from memory via /api/snapshot; the page tries that first and falls back to this file.

Robustness: keeps the last good value for any ticker that fails this run (so a Yahoo rate-limit
from a datacenter IP degrades to "last good", never to empty). Yahoo data is ~15-min delayed.

Usage:  python3 build_snapshot.py
"""
import json, os, sys, time, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
COMPANIES = os.path.join(ROOT, "data", "companies.json")
SNAP_FILE = os.path.join(ROOT, "data", "live_snapshot.json")

try:
    import yfinance as yf
except ImportError:
    sys.exit("Install deps:  pip install yfinance")

_FX = {}
FXSYM = {"USD":"EURUSD=X","NOK":"EURNOK=X","GBP":"EURGBP=X","CHF":"EURCHF=X","SEK":"EURSEK=X","DKK":"EURDKK=X"}

def fx(ccy):
    if ccy in ("EUR", None): return 1.0
    sym = FXSYM.get(ccy)
    if not sym: return 1.0
    if sym not in _FX:
        try:
            _FX[sym] = float(yf.Ticker(sym).fast_info.last_price)
        except Exception:
            _FX[sym] = 1.0
    return _FX[sym] or 1.0

def fields(sym):
    """(price_eur, change_pct, market_cap_eur, currency). Price AND market cap are in the
    quote currency; LSE (.L) quotes both in pence (GBp), so both get /100 then GBP->EUR."""
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

def main():
    companies = json.load(open(COMPANIES))["companies"]
    listed = [c for c in companies if c.get("is_listed") and c.get("yahoo_ticker")]
    try:
        old = json.load(open(SNAP_FILE)).get("quotes", {})    # last good
    except Exception:
        old = {}
    snap = dict(old)
    ok = changed = 0
    for c in listed:
        try:
            p, ch, mc, cur = fields(c["yahoo_ticker"])
            if p is None and mc is None:
                continue
            ok += 1
            prev = old.get(c["id"])
            if prev and prev.get("price_eur") == p and prev.get("market_cap_eur") == mc:
                continue                                       # value unchanged — keep prior entry (incl. ts)
            snap[c["id"]] = {"price_eur": p, "change_pct": ch, "market_cap_eur": mc,
                             "currency": cur, "ts": int(time.time())}
            changed += 1
        except Exception as e:
            print(f"  ! {c['id']} ({c['yahoo_ticker']}): {e}")
        time.sleep(0.12)
    listed_ids={c["id"] for c in listed}
    snap={k:v for k,v in snap.items() if k in listed_ids}   # drop quotes for companies no longer in the universe
    if changed == 0 and os.path.exists(SNAP_FILE) and set(snap)==set(old):
        print(f"no value changes ({ok}/{len(listed)} checked) — leaving snapshot as-is (no commit)")
        return
    ts = int(time.time())
    out = {"as_of": datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat(),
           "ts": ts, "n": len(snap), "quotes": snap}
    os.makedirs(os.path.dirname(SNAP_FILE), exist_ok=True)
    json.dump(out, open(SNAP_FILE, "w"), separators=(",", ":"))
    print(f"live_snapshot.json: {changed} changed / {ok} checked / {len(snap)} total  ({datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')})")

if __name__ == "__main__":
    main()
