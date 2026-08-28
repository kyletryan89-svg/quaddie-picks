# Provider spike — M0 (automated field ingestion)

**Result: a source works.** The Ladbrokes/Neds Entain **affiliates** racing API
returns usable JSON from Vercel in both `syd1` and `iad1`. Everything below was
captured from real responses on 2026-08-29 (AEST), saved verbatim under
`docs/samples/`.

## How the spike was run

1. `app/api/spike/route.ts` was written and deployed to Vercel **preview only**
   (never production). It probes each candidate source and returns, per probe,
   the HTTP status, `content-type`, a truncated raw body, and the parsed JSON
   when the body parses.
2. It was hit twice: once with `vercel.json` pinned to `regions: ["syd1"]`
   (the project default per D8) and once with the region pin removed (deploys
   to `iad1`, US).
3. Candidate order (stop at the first that returns usable JSON):

| # | Source | syd1 | iad1 (US) |
|---|--------|------|-----------|
| 1 | TAB `api.beta.tab.com.au/v1/tab-info-service` | **403 Access Denied** (Akamai, `errors.edgesuite.net`) | **200 HTML geo-block** — *"tab.com.au is unavailable from your location"* |
| 2 | Same, region unset (US) | — | (above) — TAB is dead in both regions |
| 3 | **Ladbrokes/Neds Entain affiliates API** | **200 `application/json`** | **200 `application/json`** |
| 4 | racing.com | 200 `text/html` (SPA shell; real data is authed XHR) | 200 `text/html` |

## Per-source detail

### 1 & 2 — TAB (dead)

- **syd1**: `GET /v1/tab-info-service/racing/dates/2026-08-29/meetings?jurisdiction=VIC`
  → `403` `text/html`, Akamai **"Access Denied"** (reference `18.3658d617…`).
  `GET /v1/tab-info-service` alone **hangs** (15s timeout). This is Akamai bot
  protection, not something a plain `fetch` can satisfy.
- **iad1 (US)**: same endpoint → `200` but `text/html` with *"tab.com.au is
  unavailable from your location… visiting from a country we are unable to give
  access to"* — a geographic block.
- **Conclusion**: TAB is unreachable (bot-walled from AU, geo-blocked from US).
  Not usable.

### 3 — Ladbrokes/Neds Entain affiliates API (WINNER)

Base URL (all three work; the documented one is `api.ladbrokes.com.au`):

- `https://api.ladbrokes.com.au/affiliates/v1`
- `https://api-affiliates.ladbrokes.com.au/affiliates/v1`
- `https://api.neds.com.au/affiliates/v1`

Requires identifying headers on every request (their docs, and echoed by the
search result in this spike):

```
From: <contactable email>
X-Partner: <name identifying you>
```

Endpoints (see `docs/provider-mapping.md` for the full field map):

- `GET /racing/meetings?category=T&country=AUS&date_from={YYYY-MM-DD}&date_to={YYYY-MM-DD}`
  → `data.meetings[]` with `name`, `date`, `state` (NSW/VIC/QLD/SA/…), and
  `races[]` (`id`, `race_number`, `name`, `start_time`, `distance`, …).
- `GET /racing/events/{raceId}` → `data.race` (`status`, `race_number`, …),
  `data.results[]` (`position`, `runner_number`, `name`, …) when run,
  `data.dividends[]` (tote products incl. **Tote Win**), `data.runners[]`
  (`runner_number`, `name`, `is_scratched`, `jockey`, `trainer_name`,
  `weight`, `barrier`, `odds.fixed_win`, `last_twenty_starts`, …).

Confirmed live on 2026-08-29: `2026-08-29` returned 12 AUS thoroughbred
meetings including **Caulfield (VIC)** and **Rosehill (NSW)**, each with their
full race list. A completed race (`Sandown R9 2026-08-22`, `status:"Final"`)
carried `results` and `dividends` — the SP evidence (see mapping doc).

### 4 — racing.com (not JSON)

`GET /racing.com/form/{date}/racing` → `200 text/html`, a client-rendered SPA.
The actual form data is loaded by authenticated XHR in the browser; there is no
public JSON endpoint reachable with a plain fetch.

## Decision

Build M1 against **source 3** (`api.ladbrokes.com.au/affiliates/v1`), region
`syd1` (works and is the project's existing region per D8). The `From` /
`X-Partner` values are placeholders (`quaddie-picks@…` / `quaddie-picks`) and
should be replaced with real contact values via env before this is relied on in
anger — noted in `docs/provider-mapping.md`.
