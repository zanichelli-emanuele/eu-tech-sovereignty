# EU·SOV Terminal — EU Tech Sovereignty

A **Bloomberg-style terminal** for the European companies that could form the EU's sovereign
technology stack, mapped to the **European Technological Sovereignty Package** (3 Jun 2026:
Chips Act 2.0, Cloud & AI Development Act, Open Source Strategy).

Dense, keyboard-friendly, multi-panel: a sortable **universe** table, a 2D **network map** and an
**adjacency matrix** of the relationships, and a **security** panel with financials (or private
valuation), an EUR price chart, sourced facts and connections.

> **Informational only — NOT investment advice.** Figures are point-in-time (≈2026-06-05) and may
> be stale; verify live quotes and primary filings before any decision.

---

## Run

Static single-page app reading local JSON — no build step, no API keys.

```bash
cd dashboard
python3 -m http.server 8000      # any static server
# open http://localhost:8000
```

Serve over **http://** (not `file://`) so the browser can `fetch()` the data. Works in any modern
browser; the relationship views use the 2D `<canvas>` API (no WebGL needed).

### Navigate
- **Command bar** (top): type a company / ticker / domain code, **⏎** to jump. `/` focuses it.
- **Universe** (left): sortable, dense table — click a column header to sort; click a row to load it.
  Filter chips toggle the 9 domains + Listed/Private (or keys **1–9**).
- **Main** (centre): **NETWORK MAP** (companies as nodes in 9 domain regions; edges styled by type —
  hover to trace links, click to load, scroll to zoom, drag to pan) and **MATRIX** (adjacency grid;
  hover a cell for the link, click a row/column to load). Switch with the tabs or **M / X**.
- **Security** (right): selected company — financials or private valuation/funding/investors (with
  `as_of` + source), **1Y/5Y** price chart, description, sovereignty role, clickable connections,
  and any data caveats.
- **Keyboard:** `/` search · `↑/↓` move selection · `M`/`X` map/matrix · `1–9` toggle domains.
- **Deep links:** `…/#<company-id>` selects a company; `…/?view=matrix` opens the matrix. Selecting
  updates the URL hash so views are shareable.

---

## Refresh the price data

```bash
pip install -r requirements.txt          # yfinance + pandas
python3 fetch_data.py                     # all listed companies  (or: python3 fetch_data.py asml ifx)
```
Pulls ~5y daily adjusted closes (yfinance, stooq fallback), normalises to EUR (per-date FX), writes
`data/prices/<id>.json`. Cache-safe; private companies skipped. (Unchanged by the UI redesign.)

---

## Data model (`data/`) — unchanged
- **`companies.json`** `{ meta, companies[] }` — per company: `id, name, hq_country, domain` (one of
  `meta.domains`), `founded, is_listed, ticker, yahoo_ticker, exchange, currency, description,
  sovereignty_role`, `financials{market_cap_eur, revenue_eur, revenue_growth_pct, gross_margin_pct,
  net_margin_pct, pe_ratio, net_debt_eur, employees, as_of_date, source_url}` (listed) or
  `private_data{last_valuation_eur, total_funding_eur, key_investors[], as_of_date, source_url}`,
  `size_eur` (node-size driver), `sources[]`, `uncertain[]`.
- **`relationships.json`** `{ meta, relationships[] }` — `{source_id, target_id, type, note, source_url}`,
  `type` ∈ `supply_chain · ownership · partnership · customer` (provider→consumer / owner→owned).
- **`data/prices/<id>.json`** — `{…, prices:[{date, close}]}` in EUR (from `fetch_data.py`).

### Add / edit a company
1. Add a record to `data/companies.json` (unique `id`, exact `domain` label, cite `sources`; set
   `yahoo_ticker` with the right suffix — `.PA .DE .AS .MC .MI .HE .ST .OL .L`, or none for US like `NXPI`).
2. Set `size_eur` (or leave `null` for default size).
3. Add documented links to `data/relationships.json` (each with `source_url`).
4. `python3 fetch_data.py <id>` for its price history (listed only). Reload the page.
Domain colours/abbreviations live once in `js/app.js` (`DOMAIN_COLORS`, `DOM_ABBR`); table, filters,
map, matrix, legend and search are all generated from the data.

---

## Files
```
dashboard/
  index.html        terminal shell (command bar · universe · main · security · status)
  css/style.css     Bloomberg dark/amber theme
  js/app.js         data load, universe table, filters, command, keyboard, state, status
  js/security.js    detail panel + Chart.js price chart + connections
  js/map2d.js        2D network map (canvas)
  js/matrix.js       adjacency matrix (canvas)
  lib/chart.umd.js  Chart.js (vendored, offline)
  data/…            companies.json · relationships.json · prices/<id>.json
  fetch_data.py     re-runnable EUR price pipeline (yfinance + stooq)
```
*(The earlier three.js 3D "galaxy" UI was retired in favour of this terminal; three.js is no longer used.)*

## Sourcing & integrity
Listed financials are point-in-time market data via yfinance/Yahoo Finance (FX-normalised to EUR;
rates in `companies.json` `meta.fx_note`). Descriptions, sovereignty roles, private valuations and
every relationship edge carry a cited `source_url`; estimates/uncertainties are flagged per record
(`uncertain[]`) and surfaced in the Security panel. Counterparties outside this universe (TSMC,
Microsoft, NVIDIA, SES…) are intentionally omitted from the edges.
