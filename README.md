# EU Tech Sovereignty Universe — interactive 3D galaxy

An interactive **three.js** galaxy of the European companies that could form the EU's
sovereign technology stack, mapped to the **European Technological Sovereignty Package**
(adopted 3 June 2026: Chips Act 2.0, Cloud & AI Development Act, Open Source Strategy).

Each **star = a company**, each **constellation = a domain** (materials → semis → connectivity
→ cloud → AI → cyber/defence → enterprise software → quantum → space), and the **light-trails**
are supply-chain, ownership and partnership links. Click a star to fly to it and open a
detail panel with description, sovereignty role, financials (or private valuation) and an
interactive EUR price chart.

> **Informational only — NOT investment advice.** All figures are point-in-time
> (≈2026-06-05) and may be stale; verify live quotes and primary filings before any decision.

---

## Run it

It's a static single-page app that reads local JSON. No build step, no API keys.

```bash
cd dashboard
python3 -m http.server 8000      # any static server works
# then open http://localhost:8000
```

Must be served over **http://** (not opened as a `file://` path) so the browser can
`fetch()` the JSON. Any static server is fine (`npx serve`, `php -S`, etc.).

**Browser / WebGL:** needs a modern browser with WebGL (Chrome, Edge, Firefox, Safari) and
hardware acceleration. If WebGL is unavailable the page shows a graceful message instead of
crashing (the data still lives in `data/companies.json`). Pixel ratio is capped and geometry
reused so it runs on modest GPUs.

### Controls
- **Drag** orbit · **scroll** zoom · **right-drag** pan · idle → gentle auto-rotate.
- **Hover** a star → trace its links (neighbours highlighted, rest dimmed) + tooltip.
- **Click** a star → camera flies to it + detail panel opens.
- **Left panel:** legend doubles as domain filters; toggle listed vs private.
- **Search box** (top) → type a name, Enter to fly to it.
- **Stack layers** button → re-arranges the cosmos into horizontal strata
  (materials at the base → AI/space on top) with an animated transition.

---

## Refresh the price data

```bash
cd dashboard
pip install -r requirements.txt          # yfinance + pandas
python3 fetch_data.py                     # refresh all listed companies
python3 fetch_data.py asml ifx soitec     # or just a few ids
```

- Pulls ~5 years of daily **adjusted** closes via **yfinance** (stooq.com CSV fallback for
  US tickers), normalises to **EUR** using per-date EUR-cross FX, and writes
  `data/prices/<id>.json` (`{date, close}` in EUR).
- **Cache-safe:** a failed live fetch never overwrites a good cached file, and the dashboard
  renders from whatever `data/prices/*.json` already exist. Private companies are skipped.
- Logs which fetches succeeded / failed / were served from cache, with `as_of` dates.

---

## Data model (`data/`)

### `companies.json` → `{ meta, companies[] }`
One record per company:

| field | notes |
|---|---|
| `id` | stable kebab-case key (used by edges + price files) |
| `name`, `hq_country`, `domain` | `domain` must be one of the 9 labels in `meta.domains` |
| `founded`, `is_listed`, `ticker`, `yahoo_ticker`, `exchange`, `currency` | `yahoo_ticker` drives `fetch_data.py` |
| `description` | 2–3 sentences: what they make/sell |
| `sovereignty_role` | 1–2 sentences: why they matter to the EU stack |
| `financials` | listed: `market_cap_eur, revenue_eur, revenue_growth_pct, gross_margin_pct, net_margin_pct, pe_ratio, net_debt_eur, employees, as_of_date, source_url` (net_debt negative = net cash) |
| `private_data` | unlisted: `last_valuation_eur, total_funding_eur, key_investors[], as_of_date, source_url` |
| `size_eur` | precomputed node-size driver (market cap, or valuation/funding/revenue); `null` → default size |
| `sources[]`, `uncertain[]` | backing URLs; flagged estimates / status caveats (shown in the panel) |

### `relationships.json` → `{ meta, relationships[] }`
Conservative, **sourced** edges only:
`{ source_id, target_id, type, note, source_url }` where `type` ∈
`supply_chain` · `ownership` · `partnership` · `customer`. Direction is
provider → consumer (supply_chain, customer) or owner → owned (ownership);
partnership is undirected.

### `data/prices/<id>.json`
`{ id, ticker, currency:"EUR", source, fx_note, as_of, n, prices:[{date, close}] }` — written
by `fetch_data.py`.

---

## Add or edit a company

1. Add/edit the record in `data/companies.json` (keep `id` unique; use an existing `domain`
   label exactly; cite `sources`). For listed firms set `yahoo_ticker` (with the right suffix,
   e.g. `.PA .DE .AS .MC .MI .HE .ST .OL .L`, or no suffix for US-listed like `NXPI`).
2. Set `size_eur` (or leave `null` for a default-sized node).
3. Add any documented links in `data/relationships.json` (each with a `source_url`).
4. `python3 fetch_data.py <id>` to fetch its price history (listed only).
5. Reload the page.

Domain colours are defined once in `js/main.js` (`DOMAIN_COLORS`); the legend, filters and
search are generated from the data, so no other edits are needed.

---

## Sourcing & integrity

- Financials for listed companies are point-in-time market data via **yfinance/Yahoo Finance**
  (2026-06-05), FX-normalised to EUR (rates recorded in `companies.json` `meta.fx_note`).
  Descriptions, sovereignty roles, private valuations and every relationship edge are backed
  by a cited `source_url`; estimated or uncertain values are flagged in each record's
  `uncertain[]` and surfaced in the detail panel.
- Several real-world status notes are encoded (e.g. **Software AG** and **WithSecure** are now
  private/delisted; **NXP** is Dutch-HQ but US-listed; **OHB** has a thin free float; several
  AI/quantum firms have pending SPAC/M&A). Counterparties outside this universe (TSMC, Microsoft,
  NVIDIA, SES, Hispasat…) are intentionally omitted from the edge list.

## Files
```
dashboard/
  index.html              # SPA shell + importmap (local three.js) + overlays
  css/style.css           # dark glassy cinematic UI
  js/main.js              # three.js scene: galaxy, bloom, picking, edges, labels, fly-to, filters, layers
  js/panel.js             # detail drawer + Chart.js price chart + connections
  lib/                    # vendored three.js r160 (ES modules) + Chart.js 4 — offline-capable
  data/companies.json     # curated company dataset
  data/relationships.json # sourced edges
  data/prices/<id>.json   # cached EUR price series (from fetch_data.py)
  fetch_data.py           # re-runnable price pipeline (yfinance + stooq, EUR-normalised, cache-safe)
  requirements.txt
```
