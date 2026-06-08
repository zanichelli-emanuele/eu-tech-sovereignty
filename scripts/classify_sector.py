#!/usr/bin/env python3
"""classify_sector.py — KEYLESS sector classification (Layer 2), no model.

Reads data/candidates.json (from discover.py) and data/keywords.json. For the two
SECTOR-shaped instruments (Chips Act 2.0 -> 'Semiconductors', CADA -> 'Cloud & AI')
it scores each candidate by signal count:

    score = 2*(industry name in industry_match)
          + 1*(sector name in sector_match)
          + 1*(# distinct keyword hits in the business summary)
    any exclude_keyword hit  ->  score := 0 (domain vetoed)

A candidate is assigned to the highest-scoring sector domain; band by threshold
(promote_score / candidate_score from keywords.json, overridable by THRESHOLD env).
confidence = round(min(0.95, 0.45 + 0.12*score), 2)  — a transparent function of the
matched signals, NOT a model probability. rationale lists the matched code/terms.

Writes data/classified_sector.json: [{yahoo_ticker, name, domain, band, confidence,
score, rationale, market_cap_eur}]. 'band' in {promote, candidate}; non-matches omitted.
Usage:  python3 scripts/classify_sector.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
KW = json.load(open(os.path.join(DATA, "keywords.json")))
SCORING = KW["_meta"]["scoring"]
PROMOTE = int(os.environ.get("THRESHOLD", SCORING["promote_score"]))
CANDIDATE = SCORING["candidate_score"]
PROMOTE_REQ_KW = SCORING.get("promote_requires_keyword", False)
DOMAINS = [d for d in KW if not d.startswith("_")]

def norm(s):
    """normalize dashes/spaces so 'Software—Infrastructure' == 'Software - Infrastructure'."""
    return re.sub(r"\s+", " ", (s or "").replace("—", "-").replace("–", "-")).strip().lower()

def hits(terms, text):
    found = []
    for t in terms:
        # word-boundary, case-insensitive, phrase-aware
        if re.search(r"\b" + re.escape(t.lower()) + r"\w*", text):
            found.append(t)
    return found

def score_domain(cfg, sector, industry, summary):
    if hits(cfg.get("exclude_keywords", []), summary):
        return 0, [], 0   # vetoed
    rat = []
    s = 0
    ind_set = {norm(x) for x in cfg.get("industry_match", [])}
    sec_set = {norm(x) for x in cfg.get("sector_match", [])}
    if norm(industry) in ind_set:
        s += SCORING["industry_match_weight"]; rat.append(f"industry='{industry}'")
    if norm(sector) in sec_set:
        s += SCORING["sector_match_weight"]; rat.append(f"sector='{sector}'")
    kw = hits(cfg.get("keywords", []), summary)
    s += SCORING["keyword_weight_each"] * len(kw)
    if kw: rat.append("keywords[" + ", ".join(kw[:6]) + ("…" if len(kw) > 6 else "") + "]")
    return s, rat, len(kw)

def classify(cand):
    summary = norm(cand.get("summary"))
    best = None
    for dom in DOMAINS:
        s, rat, nkw = score_domain(KW[dom], cand.get("sector"), cand.get("industry"), summary)
        if s >= CANDIDATE and (best is None or s > best[1] or (s == best[1] and "industry=" in " ".join(rat))):
            best = (dom, s, rat, nkw)
    if not best: return None
    dom, s, rat, nkw = best
    conf = round(min(0.95, 0.45 + 0.12 * s), 2)
    band = "promote" if (s >= PROMOTE and (nkw > 0 or not PROMOTE_REQ_KW)) else "candidate"
    if s >= PROMOTE and nkw == 0 and PROMOTE_REQ_KW:
        rat.append("(code-only → capped at candidate)")
    return {"yahoo_ticker": cand["yahoo_ticker"], "name": cand["name"], "domain": dom,
            "band": band, "confidence": conf, "score": s, "rationale": " + ".join(rat),
            "market_cap_eur": cand.get("market_cap_eur")}

def main():
    cands = json.load(open(os.path.join(DATA, "candidates.json")))
    out = [r for r in (classify(c) for c in cands) if r]
    out.sort(key=lambda r: (-r["score"], r["domain"]))
    json.dump(out, open(os.path.join(DATA, "classified_sector.json"), "w"), ensure_ascii=False, indent=1)
    import collections
    by = collections.Counter((r["domain"], r["band"]) for r in out)
    print(f"sector-classified {len(out)} / {len(cands)} candidates (promote>={PROMOTE}, candidate>={CANDIDATE})")
    for k, v in sorted(by.items()): print(f"  {v:3}  {k[0]} · {k[1]}")
    return out

if __name__ == "__main__":
    main()
