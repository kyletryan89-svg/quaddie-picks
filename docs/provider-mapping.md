# Provider mapping — Ladbrokes/Neds Entain affiliates API

Written from real responses only (`docs/samples/`). Source: source 3 of the
spike (`docs/provider-spike.md`).

Base URL: `https://api.ladbrokes.com.au/affiliates/v1`

Required headers on every request:

```
From: quaddie-picks@users.noreply.github.com   # TODO: replace with a real email
X-Partner: quaddie-picks                        # TODO: replace with a real name
```

> These are placeholders. The provider's docs require values that identify you
> and give a way to contact you, or they may rate-limit/block. Wire real values
> through env before relying on this in production.

## getSaturdayMeetings → `/racing/meetings`

```
GET /racing/meetings?category=T&country=AUS&date_from={YYYY-MM-DD}&date_to={YYYY-MM-DD}
```

Response: `{ header, params, data: { meetings: [ … ] } }`.

`data.meetings[i]`:

| API field | Type | Meaning / maps to |
|-----------|------|-------------------|
| `meeting` | uuid | provider meeting id (meetingId for `getCard`) |
| `name` | string | **track name** — but normalised: `"Rosehill"` not "Rosehill Gardens", `"Randwick"` not "Royal Randwick" |
| `date` | string `YYYY-MM-DDT00:00:00Z` | meeting date (UTC midnight) |
| `category` | `"T"`/`"H"`/`"G"` | thoroughbred = `"T"` (filtered in the query) |
| `category_name` | string | "Thoroughbred Horse Racing" |
| `country` | `"AUS"` | country (filtered in the query) |
| `state` | `"NSW"`/`"VIC"`/`"QLD"`/`"SA"`/… | **jurisdiction** — drives the metro whitelist and the host-tote SP choice |
| `races[]` | array | race card (see below) |

`meeting.races[i]`:

| API field | Type | Meaning |
|-----------|------|---------|
| `id` | uuid | race id (raceId for `getRunners`/`getResult`) |
| `race_number` | int | 1-based race number on the card (`0` = non-race "jockey challenge" rows — skip) |
| `name` | string | race name |
| `start_time` | string ISO UTC | advertised jump |
| `distance` | int | metres |
| `track_condition` | string | e.g. `"Soft7"`, `"Good4"` |
| `weather` | string | e.g. `"Fine"`, `"Overcast"` |

## getCard / getRunners / getResult → `/racing/events/{raceId}`

```
GET /racing/events/{raceId}
```

Response: `{ header, params, data: { race, favourite, runners[], derivatives, mover, … } }`,
plus `results[]` and `dividends[]` once the race has run.

### `data.race`

| API field | Type | Meaning |
|-----------|------|---------|
| `event_id` | uuid | race id |
| `meeting_name` | string | track name (same normalisation as above) |
| `meeting_id` | uuid | parent meeting id |
| `status` | string | `"Open"` / `"Closed"` / `"Live"` / `"Interim"` / `"Final"` / `"Abandoned"` |
| `race_number` | int | race number |
| `type` | `"T"`/`"G"`/`"H"` | thoroughbred = `"T"` |
| `state` | string | jurisdiction (host tote) |
| `distance` | int | metres |
| `track_condition` | string | |

### `data.runners[i]` (the field)

| API field | Type | Meaning / maps to |
|-----------|------|-------------------|
| `entrant_id` | uuid | entrant id (unused by the app) |
| `runner_number` | int | **runner number** |
| `name` | string | **runner name** |
| `is_scratched` | bool | **scratched** flag |
| `barrier` | int | barrier |
| `jockey` | string | jockey |
| `trainer_name` | string | trainer |
| `weight` | `{ allocated, total }` | weights (display) |
| `last_twenty_starts` | string | form line (e.g. `"6x12022x79"`) |
| `odds.fixed_win` | float | **fixed win odds — NOT the SP** |
| `odds.fixed_place` | float | fixed place |
| `flucs` | float[] | price fluctuations |
| `form_comment` / `age` / `sex` / `colour` | misc | extra form detail (unused) |

### `data.results[]` (once run)

| API field | Type | Meaning |
|-----------|------|---------|
| `position` | int | 1 = winner |
| `runner_number` | int | **winner number** |
| `name` | string | **winner name** |
| `barrier` | int | barrier |
| `margin_length` | float | winning margin |

Winner = the entry with `position === 1`.

### `data.dividends[]` (once run) — the SP

Each dividend row: `{ id, tote, product_name, status, dividend, pool_size, positions[] }`.

| API field | Type | Meaning |
|-----------|------|---------|
| `tote` | `"VIC"`/`"NSW"`/`"QLD"`/`"UNKNOWN"` | which totalisator |
| `product_name` | string | `"Tote Win"`, `"Tote Place"`, `"Exacta"`, `"Quinella"`, `"Trifecta"`, `"Quadrella"`, … |
| `status` | `"Final"`/`"Interim"` | |
| `dividend` | float | **total return per $1 including stake** |
| `positions[]` | `{ runner_number, position }` | |

## The SP — confirmed against completed races

`winner_sp` is the **"Tote Win" dividend for the host state** (the state
matching the meeting/race `state`), i.e. the tote starting price, expressed as
total return per $1 including stake — exactly the app's `winner_sp` convention.

Verified against two completed VIC races (Sandown, 2026-08-22):

| Race | Winner | fixed_win | VIC "Tote Win" | NSW | QLD |
|------|--------|-----------|----------------|-----|-----|
| R8 Dr Sheahan Plate | #7 Gold Coast Belle | 2.25 | **2.3** | 2.2 | 2.2 |
| R9 Ladbrokes Hosted Pots | #9 Stay Silent | 4.8 | **5.0** | 4.8 | 4.5 |

The fixed odds (`odds.fixed_win`) differ from the host tote win in both races,
so the two fields are unambiguously distinct, and the tote win is the SP. The
host state is `data.race.state` (VIC for a VIC metro meeting).

**Resolution rule:** find `dividends[]` where `product_name === "Tote Win"` and
`tote === race.state`, take `dividend`. If absent, fall back to any
`product_name === "Tote Win"` row. If none, `winner_sp` is `null` and manual
entry is required.

## Track-name normalisation

The provider's `name` omits words the whitelist uses elsewhere:

| Provider name | Whitelist name (M2) |
|---------------|---------------------|
| `Caulfield` | Caulfield |
| `Flemington` | Flemington |
| `Moonee Valley` | Moonee Valley |
| `Sandown` | Sandown |
| `Randwick` | Randwick |
| `Rosehill` | Rosehill Gardens |
| `Warwick Farm` | Warwick Farm |
| `Canterbury` | Canterbury Park |

Matching is done on normalised name (lowercased, non-alphanumerics stripped,
and a small alias table), never on the provider mnemonic — the provider carries
no venue mnemonic in this feed, only `name` and `state`.
