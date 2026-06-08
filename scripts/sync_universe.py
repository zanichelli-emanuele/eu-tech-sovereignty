#!/usr/bin/env python3
"""sync_universe.py — merge classifications into the universe (Layer 2), with audit.

Reads data/classified_sector.json + data/classified_theme.json + data/candidates.json
+ data/companies.json and resolves, per company, the PRIMARY category + affiliations[]
tags + provenance, then computes the add/remove/reclassify/tag diff.

Tag-vs-primary (no model):
  - SECTOR hit  -> sector is PRIMARY; any roster membership becomes an affiliations[] tag.
  - No sector, roster member, market_cap_eur <= CAP_EUR (or unpriced) -> THEMATIC primary.
  - No sector, roster member, market_cap_eur >  CAP_EUR -> TAG-ONLY (diversified giant; logged).
Bands: sector promote -> add; sector candidate -> CANDIDATE (greyed, source kept, band='candidate');
theme membership -> promote (binary). THRESHOLD/CAP_EUR via env.

Provenance: curated entries are PINNED (domain + prose never changed; affiliations[] tags
may be added additively). auto-* entries are re-validated: ticker no longer resolved ->
remove (logged); no longer classifies -> remove/reclassify (logged).

--dry-run : compute + write data/universe_log.json ONLY; never touch companies.json.
(no flag) : also apply the diff to companies.json (guarded: aborts on degenerate result).
Usage:  python3 scripts/sync_universe.py --dry-run
"""
import json, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DRY = "--dry-run" in sys.argv
PREVIEW = "--preview" in sys.argv      # build companies.proposed.json + diff; never touch companies.json
APPLY = "--apply" in sys.argv          # write companies.json (guarded)
CAP_EUR = float(os.environ.get("CAP_EUR", "20e9"))
MIN_AUTO_FRACTION = 0.5                 # empty-file guard: abort if auto count drops below half of prior
TODAY = datetime.date.today().isoformat()
SUFFIX_EXCH = {".MI": ("Borsa Italiana", "EUR"), ".DE": ("XETRA", "EUR"), ".PA": ("Euronext Paris", "EUR"),
    ".AS": ("Euronext Amsterdam", "EUR"), ".HE": ("Nasdaq Helsinki", "EUR"), ".ST": ("Nasdaq Stockholm", "SEK"),
    ".OL": ("Oslo Børs", "NOK"), ".CO": ("Nasdaq Copenhagen", "DKK"), ".MC": ("BME Madrid", "EUR"),
    ".BR": ("Euronext Brussels", "EUR"), ".VI": ("Wiener Börse", "EUR"), ".WA": ("GPW Warsaw", "PLN"),
    ".IR": ("Euronext Dublin", "EUR"), ".LS": ("Euronext Lisbon", "EUR"), ".AT": ("Athens", "EUR")}
FIN_KEYS = ["market_cap_eur", "revenue_eur", "revenue_growth_pct", "gross_margin_pct", "net_margin_pct",
            "pe_ratio", "net_debt_eur", "employees", "as_of_date", "source_url"]

def kebab(s):
    s = (s or "").lower()
    s = re.sub(r"\b(s\.?p\.?a\.?|n\.?v\.?|s\.?a\.?s?|se|ag|plc|oyj|asa|gmbh|ab|sdb|group|holdings?|the)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "x"

def build_auto_record(r, cand, band):
    """Full companies.json record for an auto-sector entry (promote or candidate band)."""
    yt = r["ticker"]; suf = "." + yt.split(".", 1)[1] if "." in yt else ""
    exch, ccy = SUFFIX_EXCH.get(suf, (None, "USD" if suf == "" else "EUR"))
    cand = cand or {}
    fin = {k: None for k in FIN_KEYS}
    fin["market_cap_eur"] = r.get("market_cap_eur"); fin["as_of_date"] = TODAY
    fin["source_url"] = "https://finance.yahoo.com/quote/" + yt
    return {
        "id": kebab(r["name"]), "name": r["name"], "hq_country": cand.get("country"),
        "domain": r["domain"], "founded": None, "is_listed": True,
        "ticker": yt.split(".")[0], "yahoo_ticker": yt, "exchange": exch, "currency": ccy,
        "description": (cand.get("summary") or "")[:600] or None,
        "sovereignty_role": f"Auto-classified by sector codes + keywords ({r['rationale']}). Heuristic — operates in a targeted area, NOT a confirmed beneficiary.",
        "financials": fin, "private_data": None, "size_eur": r.get("market_cap_eur"),
        "sources": ["https://finance.yahoo.com/quote/" + yt],
        "uncertain": ["Auto-classified (deterministic sector codes + keywords); not hand-curated. Financials point-in-time via yfinance."],
        "source": "auto-sector", "band": band, "confidence": r["confidence"],
        "classified_at": TODAY, "rationale": r["rationale"], "affiliations": [],
    }

def build_proposed(companies, log, cands):
    out = []
    for c in companies:                         # PIN curated: copy verbatim, only stamp source
        c2 = dict(c); c2.setdefault("source", "curated"); out.append(c2)
    have = {c.get("yahoo_ticker") for c in companies}
    for r in [x for x in log["added"] if x.get("ticker")] + log["candidates"]:
        band = "candidate" if r in log["candidates"] else "promote"
        if r["ticker"] not in have:
            out.append(build_auto_record(r, cands.get(r["ticker"]), band)); have.add(r["ticker"])
    return out

def load(p, d=None):
    try: return json.load(open(os.path.join(DATA, p)))
    except Exception: return d

def main():
    companies = load("companies.json")["companies"]
    sector = load("classified_sector.json", [])
    theme = load("classified_theme.json", [])
    cands = {c["yahoo_ticker"]: c for c in load("candidates.json", [])}
    by_tic = {c["yahoo_ticker"]: c for c in companies if c.get("yahoo_ticker")}
    resolved = set(cands)               # tickers that resolved this discovery run
    prior_auto = sum(1 for c in companies if str(c.get("source", "")).startswith("auto"))

    sec_by = {s["yahoo_ticker"]: s for s in sector}
    themes_by = {}                      # ticker -> [memberships]; name-only members keyed by name
    theme_private = []                  # company-like members with no listed ticker
    for t in theme:
        if t.get("yahoo_ticker"): themes_by.setdefault(t["yahoo_ticker"], []).append(t)
        else: theme_private.append(t)

    log = {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "dry_run": DRY,
           "cap_eur": CAP_EUR, "added": [], "candidates": [], "tags_added": [], "sector_wins": [],
           "cap_demotions": [], "removed": [], "reclassified": [], "warnings": [],
           "curated_pinned": 0, "thematic_members": len(theme)}

    keys = set(sec_by) | set(themes_by)
    for tic in sorted(keys):
        sec = sec_by.get(tic); ths = themes_by.get(tic, [])
        rosters = [t["roster"] for t in ths]
        existing = by_tic.get(tic)
        mc = (sec or {}).get("market_cap_eur") or (cands.get(tic) or {}).get("market_cap_eur")
        name = (sec or (ths[0] if ths else {})).get("name") or (existing or {}).get("name") or tic

        # resolve primary
        if sec:
            primary, band, source, conf, rat = sec["domain"], sec["band"], "auto-sector", sec["confidence"], sec["rationale"]
            if rosters: log["sector_wins"].append({"name": name, "ticker": tic, "primary": primary, "tags": rosters})
        elif ths:
            if mc and mc > CAP_EUR:
                log["cap_demotions"].append({"name": name, "ticker": tic, "market_cap_eur": mc, "rosters": rosters,
                                             "decision": "tag-only (diversified giant > CAP_EUR), not thematic-primary"})
                primary = None; band = source = conf = rat = None
            else:
                primary, band, source, conf, rat = ths[0]["category"], "promote", "auto-theme", 1.0, "Member of " + ths[0]["roster"]
        else:
            continue

        if existing:
            cur_src = existing.get("source", "curated")
            new_tags = [r for r in rosters if r not in (existing.get("affiliations") or [])]
            if new_tags:
                log["tags_added"].append({"name": name, "ticker": tic, "tags": new_tags,
                                          "pinned": cur_src == "curated", "current_domain": existing.get("domain")})
            if cur_src.startswith("auto"):
                # re-validate auto entry: still classifies? (here it does, since it's in keys)
                if primary and existing.get("domain") != primary:
                    log["reclassified"].append({"name": name, "ticker": tic, "from": existing.get("domain"),
                                                 "to": primary, "band": band, "rationale": rat})
            # curated -> pinned, no domain change (only tags noted above)
        else:
            if primary and band == "promote":
                log["added"].append({"name": name, "ticker": tic, "domain": primary, "source": source,
                                     "confidence": conf, "rationale": rat, "affiliations": rosters,
                                     "market_cap_eur": mc})
            elif primary and band == "candidate":
                log["candidates"].append({"name": name, "ticker": tic, "domain": primary, "source": source,
                                          "confidence": conf, "rationale": rat, "market_cap_eur": mc})

    # private/foundation thematic members (no listed ticker) -> non-listed thematic entries (cap n/a)
    for t in theme_private:
        if not any(t["name"] == a.get("name") for a in log["added"]):
            log["added"].append({"name": t["name"], "ticker": None, "domain": t["category"], "source": "auto-theme",
                                 "confidence": 1.0, "rationale": "Member of " + t["roster"], "is_listed": False,
                                 "affiliations": [t["roster"]]})

    # lifecycle: removes (auto entries whose ticker no longer resolves) + warnings (curated unresolved)
    for c in companies:
        if not c.get("is_listed") or not c.get("yahoo_ticker"): continue
        if c["yahoo_ticker"] in resolved: continue
        if str(c.get("source", "curated")).startswith("auto"):
            log["removed"].append({"name": c["name"], "ticker": c["yahoo_ticker"], "reason": "ticker no longer resolves (delisted/acquired)"})
        else:
            log["warnings"].append({"name": c["name"], "ticker": c["yahoo_ticker"], "note": "curated ticker did not resolve this run (pinned — not removed; may be sampled-out or delisted — review)"})

    log["curated_pinned"] = sum(1 for c in companies if c.get("source", "curated") == "curated")
    json.dump(log, open(os.path.join(DATA, "universe_log.json"), "w"), ensure_ascii=False, indent=1)

    # ---- report ----
    def show(title, rows, fmt):
        print(f"\n## {title} ({len(rows)})")
        for r in rows[:60]: print("   " + fmt(r))
        if len(rows) > 60: print(f"   …+{len(rows)-60} more")
    print(f"=== sync_universe {'DRY-RUN (no write)' if DRY else 'APPLY'} · CAP_EUR=€{CAP_EUR/1e9:.0f}B · thematic members={len(theme)} ===")
    show("(a) PROMOTE → would ADD", [r for r in log["added"] if r.get("ticker")],
         lambda r: f"{r['domain']:13} {r['ticker']:11} conf {r['confidence']:.2f}  {r['name'][:30]:30} ⟵ {r['rationale'][:70]}")
    show("(a') ADD non-listed (thematic private)", [r for r in log["added"] if not r.get("ticker")],
         lambda r: f"{r['domain']:13} {r['name'][:30]:30} ⟵ {r['rationale']}")
    show("(b) CANDIDATE band (greyed, unverified)", log["candidates"],
         lambda r: f"{r['domain']:13} {r['ticker']:11} conf {r['confidence']:.2f}  {r['name'][:30]:30} ⟵ {r['rationale'][:70]}")
    show("(c) tag-vs-primary — SECTOR-WINS (roster → tag)", log["sector_wins"],
         lambda r: f"{r['ticker']:11} primary={r['primary']:13} tags={r['tags']}  {r['name'][:30]}")
    show("(c) tag-vs-primary — CAP DEMOTIONS (>€20B → tag-only)", log["cap_demotions"],
         lambda r: f"{r['ticker'] or '-':11} €{(r['market_cap_eur'] or 0)/1e9:.0f}B  {r['name'][:30]:30} rosters={r['rosters']}")
    show("(c) affiliation TAGS added", log["tags_added"],
         lambda r: f"{r['ticker']:11} +{r['tags']} (pinned={r['pinned']}, domain={r['current_domain']})  {r['name'][:30]}")
    show("(d) REMOVE (auto, ticker unresolved)", log["removed"], lambda r: f"{r['ticker']:11} {r['name'][:34]:34} ⟵ {r['reason']}")
    show("(d') WARN (curated ticker unresolved — pinned)", log["warnings"], lambda r: f"{r['ticker']:11} {r['name'][:34]:34} ⟵ {r['note']}")
    print(f"\nsummary: add={len([r for r in log['added'] if r.get('ticker')])} add-nonlisted={len([r for r in log['added'] if not r.get('ticker')])} "
          f"candidate={len(log['candidates'])} sector-wins={len(log['sector_wins'])} cap-demotions={len(log['cap_demotions'])} "
          f"tags={len(log['tags_added'])} remove={len(log['removed'])} warn={len(log['warnings'])} | curated-pinned={log['curated_pinned']}")
    print(f"wrote data/universe_log.json  (dry_run={DRY})")

    if PREVIEW or APPLY:
        proposed = build_proposed(companies, log, cands)
        n_cur = sum(1 for c in proposed if c.get("source") == "curated")
        newrecs = [c for c in proposed if str(c.get("source", "")).startswith("auto")]
        # verify curated are byte-identical except the added source field
        orig = {c["id"]: c for c in companies}
        nosrc = lambda r: {k: v for k, v in r.items() if k != "source"}
        changed = [c["id"] for c in proposed if c.get("source") == "curated"
                   and orig.get(c["id"]) is not None and nosrc(c) != nosrc(orig[c["id"]])]
        print(f"\n=== {'APPLY' if APPLY else 'APPLY PREVIEW'} ===")
        print(f"curated stamped source='curated': {n_cur}/{len(companies)}  |  curated with changes beyond +source: {len(changed)} {changed[:8]}")
        print(f"new auto records: {len(newrecs)}")
        for c in newrecs:
            print(f"  +{c['source']}/{c['band']:9} {c['domain']:13} {c['yahoo_ticker']:11} conf {c['confidence']:.2f}  mc=€{(c['size_eur'] or 0)/1e9:.1f}B  {c['name'][:30]}")
        # guards
        if len(proposed) < len(companies) or n_cur != len(companies):
            sys.exit(f"ABORT guard: proposed={len(proposed)} curated={n_cur} vs existing={len(companies)} — refusing degenerate write.")
        if changed:
            sys.exit(f"ABORT: curated records would change beyond +source ({changed}). Investigate before writing.")
        if APPLY:
            if prior_auto and len(newrecs) < MIN_AUTO_FRACTION * prior_auto:
                sys.exit(f"ABORT empty-file guard: new auto={len(newrecs)} < ½ prior auto={prior_auto}.")
            d = load("companies.json"); d["companies"] = proposed
            aff = load("affiliations.json", {})
            checks = [r.get("last_checked") for k, b in aff.items() if not k.startswith("_")
                      for r in b.get("rosters", []) if r.get("last_checked")]
            d.setdefault("meta", {})["universe"] = {
                "last_discovery": TODAY,
                "thematic": {"mode": "maintainer-curated (citations)", "last_checked": max(checks) if checks else None},
                "counts": {"curated": n_cur,
                           "auto_sector": sum(1 for c in proposed if c.get("source") == "auto-sector" and c.get("band") != "candidate"),
                           "auto_theme": sum(1 for c in proposed if c.get("source") == "auto-theme"),
                           "candidate": sum(1 for c in proposed if c.get("band") == "candidate")}}
            json.dump(d, open(os.path.join(DATA, "companies.json"), "w"), ensure_ascii=False, indent=1)
            print(f"WROTE companies.json: {len(proposed)} ({n_cur} curated + {len(newrecs)} auto)")
        else:
            d = load("companies.json"); d["companies"] = proposed
            json.dump(d, open(os.path.join(DATA, "companies.proposed.json"), "w"), ensure_ascii=False, indent=1)
            print("wrote data/companies.proposed.json  (PREVIEW — companies.json untouched)")

if __name__ == "__main__":
    main()
