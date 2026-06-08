#!/usr/bin/env python3
"""discover.py — KEYLESS candidate discovery for the autonomous universe (Layer 2).

SOURCE (env, default 'stoxx'):
  stoxx : STOXX Europe 600 constituents from the iShares EXSA holdings CSV snapshot
          (data/stoxx600_holdings.csv, refreshed from ISHARES_URL when reachable),
          filtered to EU/EEA equities, UNION the current universe's listed tickers
          (so re-validation/refresh covers existing companies too).
  fmp   : stub — Financial Modeling Prep screener (needs FMP_API_KEY). Not the default;
          flip in later by adding the key. Raises if selected without a key.

For each candidate it resolves a Yahoo ticker and enriches via yfinance: sector,
industry, business summary, country, market_cap_eur. KEEP-LAST-GOOD: a ticker that
fails enrichment this run keeps its previous record (from data/candidates.json)
rather than vanishing. Concurrency-capped, gentle on Yahoo. NO API KEYS.

Env: SOURCE, LIMIT (0=all; sample size for the STOXX set, current-universe always
included), WORKERS (default 6), ISHARES_URL.
Usage:  python3 scripts/discover.py
"""
import csv, io, json, os, sys, time, datetime, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # dashboard/
DATA = os.path.join(ROOT, "data")
CANDIDATES = os.path.join(DATA, "candidates.json")
STOXX_CSV = os.path.join(DATA, "stoxx600_holdings.csv")
COMPANIES = os.path.join(DATA, "companies.json")
SOURCE = os.environ.get("SOURCE", "stoxx")
LIMIT = int(os.environ.get("LIMIT", "0"))
WORKERS = int(os.environ.get("WORKERS", "6"))
ISHARES_URL = os.environ.get("ISHARES_URL",
    "https://www.ishares.com/de/privatanleger/de/produkte/251931/ishares-stoxx-europe-600-ucits-etf-de-fund/1478358465952.ajax?fileType=csv&fileName=EXSA_holdings&dataType=fund")

# German country (iShares 'Standort') -> Yahoo suffix. EU/EEA only; others dropped.
EU_SUFFIX = {
    "Frankreich": ".PA", "Deutschland": ".DE", "Niederlande": ".AS", "Italien": ".MI",
    "Spanien": ".MC", "Schweden": ".ST", "Finnland": ".HE", "Belgien": ".BR",
    "Dänemark": ".CO", "Norwegen": ".OL", "Polen": ".WA", "Österreich": ".VI",
    "Irland": ".IR", "Portugal": ".LS", "Griechenland": ".AT", "Luxemburg": ".LU",
}
EXCLUDE_COUNTRIES = {"Vereinigtes Königreich", "Schweiz", "Vereinigte Staaten",
                     "Jersey", "Guernsey", "Isle Of Man", "Bermuda", "Kaimaninseln"}

try:
    import yfinance as yf
except ImportError:
    sys.exit("pip install yfinance")

_FX = {}
def to_eur(v, ccy):
    if v is None: return None
    if not ccy or ccy == "EUR": return round(v)
    if ccy == "GBp": ccy = "GBP"; v = v / 100.0
    if ccy not in _FX:
        try: _FX[ccy] = float(yf.Ticker(f"EUR{ccy}=X").fast_info.last_price)
        except Exception: _FX[ccy] = None
    r = _FX[ccy]
    return round(v / r) if r else None

def stoxx_tickers():
    """Refresh the iShares CSV (best-effort), then parse EU/EEA equities -> Yahoo tickers."""
    try:
        req = urllib.request.Request(ISHARES_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=25) as r:
            txt = r.read().decode("utf-8-sig", "replace")
        if "Anlageklasse" in txt or "Asset Class" in txt:
            open(STOXX_CSV, "w", encoding="utf-8").write(txt)
            print("  refreshed STOXX snapshot from iShares")
    except Exception as e:
        print(f"  iShares refresh failed ({e}); using committed snapshot")
    rows = open(STOXX_CSV, encoding="utf-8-sig").read().splitlines()
    # header is the 3rd line (after the 'Fondsposition per' line and a blank line)
    hdr = next(i for i, ln in enumerate(rows) if ln.startswith("Emittententicker") or ln.startswith("Ticker"))
    rdr = csv.DictReader(io.StringIO("\n".join(rows[hdr:])))
    out = []
    for row in rdr:
        if row.get("Anlageklasse") not in ("Aktien", "Equity"): continue
        country = (row.get("Standort") or "").strip()
        if country in EXCLUDE_COUNTRIES or country not in EU_SUFFIX: continue
        tic = (row.get("Emittententicker") or row.get("Ticker") or "").strip()
        if not tic: continue
        yt = tic.replace(" ", "-") + EU_SUFFIX[country]
        out.append({"yahoo_ticker": yt, "name": (row.get("Name") or "").strip(), "country": country})
    return out

def enrich(cand):
    """yfinance enrichment for one candidate; returns dict or None (drop)."""
    yt = cand["yahoo_ticker"]
    try:
        info = yf.Ticker(yt).get_info()
        if not info or info.get("quoteType") not in ("EQUITY", None): return None
        if not info.get("sector") and not info.get("longBusinessSummary"): return None
        return {
            "yahoo_ticker": yt,
            "name": info.get("longName") or info.get("shortName") or cand.get("name") or yt,
            "country": info.get("country") or cand.get("country"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "summary": (info.get("longBusinessSummary") or "")[:1200],
            "market_cap_eur": to_eur(info.get("marketCap"), info.get("currency")),
        }
    except Exception as e:
        print(f"    ! {yt}: {e}")
        return None

def main():
    if SOURCE == "fmp":
        if not os.environ.get("FMP_API_KEY"):
            sys.exit("SOURCE=fmp needs FMP_API_KEY (keyless default is SOURCE=stoxx)")
        sys.exit("FMP source stub — not implemented in the keyless default build")
    if SOURCE != "stoxx":
        sys.exit(f"unknown SOURCE={SOURCE}")

    # candidate ticker set = STOXX EU/EEA  ∪  current universe listed tickers
    stoxx = stoxx_tickers()
    print(f"STOXX EU/EEA equities: {len(stoxx)}")
    universe = json.load(open(COMPANIES))["companies"]
    cur = [{"yahoo_ticker": c["yahoo_ticker"], "name": c["name"], "country": c.get("hq_country")}
           for c in universe if c.get("is_listed") and c.get("yahoo_ticker")]
    print(f"current listed (always included): {len(cur)}")

    seen, merged = set(), []
    pool = stoxx[:LIMIT] if LIMIT else stoxx
    for c in pool + cur:                       # current universe appended so it's never sampled out
        if c["yahoo_ticker"] not in seen:
            seen.add(c["yahoo_ticker"]); merged.append(c)
    print(f"unique candidates to enrich: {len(merged)} (LIMIT={LIMIT or 'all'}, workers={WORKERS})\n")

    prev = {}
    if os.path.exists(CANDIDATES):
        try: prev = {c["yahoo_ticker"]: c for c in json.load(open(CANDIDATES))}
        except Exception: pass

    out, ok, kept, dropped = [], 0, 0, 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(enrich, c): c for c in merged}
        for i, fut in enumerate(as_completed(futs), 1):
            c = futs[fut]; rec = fut.result()
            if rec:
                out.append(rec); ok += 1
            elif c["yahoo_ticker"] in prev:
                out.append(prev[c["yahoo_ticker"]]); kept += 1     # keep-last-good
            else:
                dropped += 1
            if i % 40 == 0: print(f"  …{i}/{len(merged)}")

    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for r in out: r.setdefault("discovered_at", ts)
    json.dump(sorted(out, key=lambda r: r["yahoo_ticker"]), open(CANDIDATES, "w"),
              ensure_ascii=False, indent=1)
    print(f"\nwrote {CANDIDATES}: {len(out)} candidates  (enriched {ok}, kept-last-good {kept}, dropped {dropped})")

if __name__ == "__main__":
    main()
