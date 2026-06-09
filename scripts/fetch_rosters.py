#!/usr/bin/env python3
"""fetch_rosters.py — KEYLESS roster fetch -> STAGING only (data/roster_candidates.json).

For each roster in affiliations.json that has a `fetch` spec, fetch its public member
directory keylessly and STAGE candidate members for human review. This script NEVER
edits affiliations.json or companies.json, makes NO model calls, and does NOT scrape
JS-rendered HTML or invent members.

fetch.type:
  json_api    : GET a JSON members endpoint; extract `name_field` (dot-path). (Eclipse)
  wp_cpt      : WordPress REST custom-post-type; paginate; extract `name_field`. (smartEn)
  prose       : GET HTML, strip tags, conservatively extract org-name-like strings
                (NOISY -> every entry status:needs-review). (IPCEI / roadmap pages)
  unavailable : no keyless source found -> record reason, stage nothing.

Each staged entry: {name, roster, category, source_url, fetched_at, website?, ticker_guess|null,
is_listed, status}.  ticker_guess is resolved ONLY by matching the member name against the
existing candidates.json + companies.json (keyless) so listed members get a Yahoo ticker for
Layer-1; everyone else stays null.  status: "auto-parsed" | "needs-review".
Approval is a separate manual step (scripts/approve_roster.py). Run weekly via universe.yml.
"""
import json, os, re, html, datetime, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); DATA = os.path.join(ROOT, "data")
UA = {"User-Agent": "Mozilla/5.0 (eusov roster fetch)"}
# EC/policy boilerplate to drop from prose extraction (not org names)
PROSE_STOP = {"european commission", "member states", "state aid", "important projects of common european interest",
              "european union", "european parliament", "european council", "directorate general", "press release",
              "important projects", "common european interest", "european"}
LEGAL = re.compile(r"\b(gmbh|se|ag|s\.?a\.?s?|n\.?v\.?|s\.?p\.?a\.?|oyj|asa|ab|plc|b\.?v\.?|ltd|sas|spa)\b\.?$", re.I)

def get(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace"), r
def dotget(o, path):
    for k in path.split("."):
        o = o.get(k) if isinstance(o, dict) else None
    return o
def norm(n):
    n = re.sub(r"\s+", " ", (n or "").lower())
    n = re.sub(r"\b(s\.?a\.?s?|n\.?v\.?|se|ag|plc|oyj|asa|gmbh|s\.?p\.?a\.?|ab|group|holdings?|the|inc|corp|ltd|co|b\.?v\.?)\b", "", n)
    return re.sub(r"[^a-z0-9 ]", "", n).strip()

def build_index():
    idx = {}
    for f in ("candidates.json", "companies.json"):
        p = os.path.join(DATA, f)
        if not os.path.exists(p): continue
        data = json.load(open(p)); rows = data["companies"] if isinstance(data, dict) else data
        for c in rows:
            if c.get("yahoo_ticker"): idx.setdefault(norm(c["name"]), c["yahoo_ticker"])
    return idx

def fetch_json_api(spec):
    txt, _ = get(spec["url"]); data = json.loads(txt)
    rows = data if isinstance(data, list) else (data.get("data") or data.get("organizations") or [])
    out = []
    for o in rows:
        if isinstance(o, dict) and o.get("is_active_member") is False: continue   # active members only
        name = dotget(o, spec.get("name_field", "name"))
        if not name: continue
        out.append((html.unescape(str(name)).strip(), (o.get("website") if isinstance(o, dict) else None)))
    return out

def fetch_wp_cpt(spec):
    out, page = [], 1
    while page <= 30:
        try: txt, _ = get(spec["url"] + f"?per_page=100&page={page}")
        except Exception: break
        try: rows = json.loads(txt)
        except Exception: break
        if not isinstance(rows, list) or not rows: break
        for o in rows:
            name = dotget(o, spec.get("name_field", "title.rendered"))
            if name: out.append((html.unescape(re.sub(r"<[^>]+>", "", str(name))).strip(),
                                 (o.get("link") if isinstance(o, dict) else None)))
        page += 1
    return out

def fetch_prose(spec, cap=80):
    txt, _ = get(spec["url"])
    text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", txt)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    cands = []
    for m in re.findall(r"\b([A-Z][\wÀ-ÿ&.\-]+(?:\s+[A-Z][\wÀ-ÿ&.\-]+){0,4})\b", text):
        s = re.sub(r"\s+", " ", m).strip()
        if not (4 <= len(s) <= 50): continue
        if s.lower() in PROSE_STOP: continue
        # keep only sequences that are >=2 words OR carry a legal/org suffix (cuts sentence-start nouns)
        if len(s.split()) < 2 and not LEGAL.search(s): continue
        cands.append((s, None))
    seen, uniq = set(), []
    for s, w in cands:
        if s.lower() in seen: continue
        seen.add(s.lower()); uniq.append((s, w))
    return uniq[:cap]

def main():
    aff = json.load(open(os.path.join(DATA, "affiliations.json")))
    idx = build_index()
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    roster_status, candidates = [], []
    for cat, blk in aff.items():
        if cat.startswith("_"): continue
        for r in blk.get("rosters", []):
            spec = r.get("fetch", {}); ftype = spec.get("type", "unavailable")
            st = {"roster": r["list"], "category": cat, "fetch_type": ftype, "source_url": r["source_url"]}
            if ftype == "unavailable":
                st.update(status="unavailable", reason=spec.get("reason", ""), count=0); roster_status.append(st); continue
            try:
                pairs = {"json_api": fetch_json_api, "wp_cpt": fetch_wp_cpt, "prose": fetch_prose}[ftype](spec)
            except Exception as e:
                st.update(status="error", reason=str(e), count=0); roster_status.append(st); continue
            status = "needs-review" if (spec.get("review") or ftype == "prose") else "auto-parsed"
            n = 0
            for name, website in pairs:
                yt = idx.get(norm(name))
                entry = {"name": name, "roster": r["list"], "category": cat, "source_url": r["source_url"],
                         "fetched_at": ts, "ticker_guess": yt, "is_listed": bool(yt), "status": status}
                if website: entry["website"] = website
                candidates.append(entry); n += 1
            st.update(status="ok", parsed=status, count=n); roster_status.append(st)
    seen, uniq = set(), []
    for c in candidates:
        k = (c["roster"], norm(c["name"]))
        if k not in seen: seen.add(k); uniq.append(c)
    out = {"generated_at": ts, "roster_status": roster_status, "candidates": uniq,
           "summary": {"total": len(uniq),
                       "auto_parsed": sum(c["status"] == "auto-parsed" for c in uniq),
                       "needs_review": sum(c["status"] == "needs-review" for c in uniq),
                       "with_ticker": sum(bool(c["ticker_guess"]) for c in uniq)}}
    json.dump(out, open(os.path.join(DATA, "roster_candidates.json"), "w"), ensure_ascii=False, indent=1)
    print("ROSTER STATUS (fetch is automated; approval is the manual gate):")
    for s in roster_status:
        line = f"  [{s['category']:13}] {s['roster'][:40]:40} {s['fetch_type']:11} {s.get('status','?'):12}"
        if "count" in s: line += f" count={s['count']}"
        if s.get("reason"): line += f"  ({s['reason'][:48]})"
        print(line)
    sm = out["summary"]
    print(f"\nstaged {sm['total']} -> data/roster_candidates.json  (auto-parsed {sm['auto_parsed']}, needs-review {sm['needs_review']}, ticker-resolved {sm['with_ticker']})")
    print("NOTHING enters affiliations.json / the universe without scripts/approve_roster.py.")

if __name__ == "__main__":
    main()
