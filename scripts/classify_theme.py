#!/usr/bin/env python3
"""classify_theme.py — KEYLESS, list-based thematic classification (Layer 2), no model.

Reads data/affiliations.json. A company is in a thematic category ('Open source',
'AI in energy') iff it appears on a roster's members[]. For each roster:
  - mode 'http'  : fetch + parse the public member directory (keyless plain HTTP). [none enabled]
  - mode 'manual': read maintainer-curated members[] from affiliations.json.
Auto-fetch is currently DISABLED for every roster (sources are JS-rendered / 404 — see
affiliations.json._meta). This script LOGS each roster's status and member count; it
never scrapes JS or invents members.

Each member is cross-referenced to a Yahoo ticker via the discovered candidates +
current universe (by normalized name); unmatched company-like members become private
non-listed entries. Writes data/classified_theme.json:
  [{name, category, roster, source_url, yahoo_ticker|null, is_listed, market_cap_eur, verified}]
Tag-vs-primary resolution happens in sync_universe.py, not here.
Usage:  python3 scripts/classify_theme.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

def norm(n):
    n = re.sub(r"\s+", " ", (n or "").lower())
    n = re.sub(r"\b(s\.?a\.?|n\.?v\.?|se|ag|plc|oyj|asa|gmbh|s\.?p\.?a\.?|sas|ab|group|holding|holdings|the)\b", "", n)
    return re.sub(r"[^a-z0-9 ]", "", n).strip()

def main():
    aff = json.load(open(os.path.join(DATA, "affiliations.json")))
    cands = json.load(open(os.path.join(DATA, "candidates.json"))) if os.path.exists(os.path.join(DATA, "candidates.json")) else []
    uni = json.load(open(os.path.join(DATA, "companies.json")))["companies"]
    # name -> (yahoo_ticker, is_listed, market_cap_eur) index from candidates + universe
    idx = {}
    for c in cands:
        idx[norm(c["name"])] = (c.get("yahoo_ticker"), True, c.get("market_cap_eur"))
    for c in uni:
        idx.setdefault(norm(c["name"]), (c.get("yahoo_ticker"), c.get("is_listed"), (c.get("financials") or {}).get("market_cap_eur")))

    out = []
    print("roster status:")
    for cat, blk in aff.items():
        if cat.startswith("_"): continue
        for r in blk.get("rosters", []):
            members = r.get("members", []) if r.get("mode") == "manual" or r.get("autofetch") != "disabled" else r.get("members", [])
            status = "disabled" if r.get("autofetch") == "disabled" else r.get("mode", "manual")
            print(f"  [{cat:14}] {r['list']:48} mode={status:8} members={len(members)}"
                  + (f"  ({r.get('autofetch_reason','')[:60]})" if r.get("autofetch") == "disabled" else ""))
            for m in members:
                key = norm(m["name"])
                yt, listed, mc = idx.get(key, (m.get("yahoo_ticker"), m.get("is_listed", False), None))
                out.append({"name": m["name"], "category": cat, "roster": r["list"], "source_url": r["source_url"],
                            "yahoo_ticker": yt, "is_listed": bool(listed), "market_cap_eur": mc,
                            "verified": m.get("verified", False)})
    json.dump(out, open(os.path.join(DATA, "classified_theme.json"), "w"), ensure_ascii=False, indent=1)
    print(f"\nthematic members classified: {len(out)}")
    if not out:
        print("  (0 — all rosters disabled/empty; thematic auto-discovery has no keyless source yet. See affiliations.json._meta NEEDS-DECISION.)")

if __name__ == "__main__":
    main()
