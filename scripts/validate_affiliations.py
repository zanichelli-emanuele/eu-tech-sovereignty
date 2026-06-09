#!/usr/bin/env python3
"""validate_affiliations.py — integrity check on APPROVED thematic members in affiliations.json.

Flags: members with no source_url (neither own nor roster), listed members missing a
yahoo_ticker, members missing hq_country, and rosters whose last_checked is missing or
stale (> STALE_DAYS, default 365). With --resolve it also verifies each yahoo_ticker
resolves via yfinance (network; otherwise keyless/structural only).
Exit code 1 if any issue (usable as a CI gate). Pass TODAY via env for deterministic stale checks.
"""
import json, os, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); DATA = os.path.join(ROOT, "data")
STALE_DAYS = int(os.environ.get("STALE_DAYS", "365"))
RESOLVE = "--resolve" in sys.argv

def main():
    aff = json.load(open(os.path.join(DATA, "affiliations.json")))
    today = datetime.date.fromisoformat(os.environ["TODAY"]) if os.environ.get("TODAY") else datetime.date.today()
    issues, n_members = [], 0
    yf = None
    if RESOLVE:
        try: import yfinance as yf
        except ImportError: print("(--resolve needs yfinance; skipping ticker resolution)"); yf = None
    for cat, blk in aff.items():
        if cat.startswith("_"): continue
        for r in blk.get("rosters", []):
            members = r.get("members", [])
            lc = r.get("last_checked")
            if members and not lc:
                issues.append(f"[{r['list']}] has {len(members)} members but no last_checked date")
            elif lc:
                try:
                    age = (today - datetime.date.fromisoformat(lc)).days
                    if age > STALE_DAYS: issues.append(f"[{r['list']}] last_checked {lc} is stale ({age}d > {STALE_DAYS})")
                except ValueError:
                    issues.append(f"[{r['list']}] last_checked '{lc}' is not an ISO date")
            for m in members:
                n_members += 1
                tag = f"[{r['list'][:24]}] {m.get('name')}"
                if not (m.get("roster_source_url") or r.get("source_url")):
                    issues.append(f"{tag}: missing source_url")
                if not m.get("hq_country"):
                    issues.append(f"{tag}: missing hq_country (EU/EEA must be verified)")
                if m.get("is_listed") and not m.get("yahoo_ticker"):
                    issues.append(f"{tag}: is_listed but no yahoo_ticker")
                if RESOLVE and yf and m.get("yahoo_ticker"):
                    try:
                        if not getattr(yf.Ticker(m["yahoo_ticker"]).fast_info, "last_price", None):
                            issues.append(f"{tag}: yahoo_ticker {m['yahoo_ticker']} did not resolve")
                    except Exception:
                        issues.append(f"{tag}: yahoo_ticker {m['yahoo_ticker']} did not resolve")
    print(f"validated {n_members} approved member(s) across rosters · {len(issues)} issue(s)")
    for i in issues: print("  ⚠", i)
    if not n_members: print("  (no approved thematic members yet — affiliations.json members[] are empty)")
    sys.exit(1 if issues else 0)

if __name__ == "__main__":
    main()
