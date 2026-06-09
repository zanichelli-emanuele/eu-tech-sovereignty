#!/usr/bin/env python3
"""approve_roster.py — THE one manual gate. Promote reviewed roster candidates from the
staging file (data/roster_candidates.json) into affiliations.json members[] — the citable,
approved thematic membership that classify_theme.py reads.

Approve either way:
  - edit data/roster_candidates.json and set  "approve": true  on the entries you want, then run with no args; or
  - pass names/tickers as args:  python3 scripts/approve_roster.py "Hello Watt" "Joulen" SU.PA

For each approved entry it appends to the matching roster's members[]:
  {name, hq_country, is_listed, yahoo_ticker, roster_source_url, verified:true, note}
and stamps that roster's last_checked = today. Deduped by normalized name (idempotent).
Does NOT touch companies.json — the next classify_theme + sync run reflects it (preview first).
"""
import json, os, re, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); DATA = os.path.join(ROOT, "data")
TODAY = datetime.date.today().isoformat()
def norm(n):
    n = re.sub(r"\s+", " ", (n or "").lower())
    n = re.sub(r"\b(s\.?a\.?s?|n\.?v\.?|se|ag|plc|oyj|asa|gmbh|s\.?p\.?a\.?|ab|group|holdings?|the|inc|corp|ltd|co)\b", "", n)
    return re.sub(r"[^a-z0-9 ]", "", n).strip()

def main():
    stage = json.load(open(os.path.join(DATA, "roster_candidates.json")))
    aff = json.load(open(os.path.join(DATA, "affiliations.json")))
    args = {a.lower() for a in sys.argv[1:]}
    def approved(e):
        return bool(e.get("approve")) or (bool(args) and (e["name"].lower() in args or (e.get("ticker_guess") or "").lower() in args))
    sel = [e for e in stage["candidates"] if approved(e)]
    if not sel:
        sys.exit('Nothing approved. Set "approve": true on entries in data/roster_candidates.json, or pass names/tickers as args.')
    rosters = {r["list"]: r for cat, blk in aff.items() if not cat.startswith("_") for r in blk.get("rosters", [])}
    added = 0
    for e in sel:
        r = rosters.get(e["roster"])
        if not r: print(f"  ! no roster '{e['roster']}' in affiliations.json"); continue
        members = r.setdefault("members", [])
        if any(norm(m.get("name")) == norm(e["name"]) for m in members): continue
        members.append({"name": e["name"], "hq_country": e.get("hq_country"),
                        "is_listed": bool(e.get("ticker_guess")), "yahoo_ticker": e.get("ticker_guess"),
                        "roster_source_url": e.get("source_url"), "verified": True, "note": e.get("note", "")})
        r["last_checked"] = TODAY; added += 1
        print(f"  + [{e['category']}] {e['roster'][:28]:28} {e.get('ticker_guess') or 'private':11} {e['name']}")
    json.dump(aff, open(os.path.join(DATA, "affiliations.json"), "w"), ensure_ascii=False, indent=1)
    print(f"\npromoted {added} member(s) into affiliations.json (last_checked={TODAY}).")
    print("Next: python3 scripts/validate_affiliations.py  then  classify_theme.py + sync_universe.py --preview")

if __name__ == "__main__":
    main()
