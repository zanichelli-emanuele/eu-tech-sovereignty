# TODO — what's left (curation, NOT automation)

The autonomous layers are **done and live**, nothing below blocks them:
- **Financials** — 15-min snapshot + daily prices (`snapshot.yml`, `prices.yml`); the page reads committed files on open.
- **Sector universe** (Semiconductors, Cloud & AI) — `universe.yml`: weekly **Sun 04:00 UTC** cron + on-demand **`workflow_dispatch`** (Actions tab → "Weekly universe scan" → Run workflow). Guarded (curated pinned, empty-file + degraded-discovery guards), proven idempotent by a supervised run. Audit trail in `data/universe_log.json`.

Two **manual curation** tasks remain — do unhurried, careful with citations:

1. **Thematic transcription → `data/affiliations.json`** (Open source, AI-in-energy).
   `members[]` are currently **empty** and auto-fetch is **disabled** (sources JS-rendered/404 — see `affiliations.json._meta`). Hand-populate, in order: **IPCEI participants** (EC press releases, most citable) → **smartEn** → **Eclipse Foundation**. Each member: `name`, `hq_country` (EU/EEA only), `is_listed`, `yahoo_ticker` (or null if private), `verified:true`, + the roster's `source_url` & `last_checked`. Then run the scan (dispatch, or local `classify_theme.py` → `sync_universe.py --preview`, review `universe_log.json`, then `--apply`). Tag-vs-primary already handled: sector hit → roster becomes an `affiliations[]` tag; pure-play ≤€20B → thematic primary; >€20B diversified → tag-only.

2. **`data/relationships.json` rebuild.** Currently 11 edges, ~74% nodes isolated, one stale edge to removed `helsing`. Hand-author a sourced edge set across the current 89 companies (each edge needs a `source_url`), weighted to `supply_chain` + `customer`. Map/matrix render straight from this file.

Pointers: `scripts/{discover,classify_sector,classify_theme,sync_universe}.py` · rules in `data/keywords.json` + `data/affiliations.json` · workflows in `.github/workflows/`.
