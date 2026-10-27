# Demo Video Script — Northstar | UK Day-Ahead Wind Desk

Format: unlisted YouTube video, max 10 minutes, two parts back-to-back.
Setup: run the app locally (`./start.sh`, then open http://localhost:18080) or
the deployed URL. Record the browser window full-screen; hide bookmarks bar.
Zoom browser to ~110% so metrics are legible on YouTube.

Numbers below are the real January 2026 figures — verify on screen before
recording, since they come from live Elexon data.

---

## Part 1 — Client pitch (~4:30 target, hard cap 5:00)

Goal: impress. Speak to the trading desk, not engineers. No code on screen.

### 0:00–0:35 — Hook and problem framing
**On screen:** Dashboard fully loaded, metrics strip visible.

> "Every morning before eleven, your desk decides how much power to buy on the
> day-ahead market — and the single biggest unknown is how much the wind will
> actually deliver. Overestimate it and you over-procure; underestimate it and
> you're short into the evening peak. We built Northstar to put a number on
> that uncertainty. It takes the national wind forecasts your desk already
> relies on — Elexon's WINDFOR — and measures them against what actually
> happened, settlement period by settlement period."

### 0:35–1:30 — The headline numbers
**On screen:** Cursor moves across the four metric tiles as each is named.

> "Here's January 2026 — all 1,488 half-hour settlement periods, fully matched.
> The mean absolute error is about 2,100 megawatts — that's the typical gap
> between the forecast you'd have traded on and the outturn. In percentage
> terms, a MAPE of roughly 22 percent. And the bias: plus 1,840 megawatts —
> meaning the forecast systematically *over*-predicted wind this month.
> On average, you'd have bought roughly 1.8 gigawatts too little thermal
> cover. That's not noise; that's a systematic position your desk can now
> see and price."

### 1:30–2:40 — The chart
**On screen:** Scroll to the forecast-vs-actual chart; hover a few points,
especially the evening of 8 January.

> "The chart shows the exact forecast your desk would have seen at the
> decision deadline against the actual outturn. Every point is the *latest
> published* forecast available before the cutoff — not a hindsight revision.
> Watch the evening of the 8th of January — the gap opens up exactly when the
> system is most stressed."

### 2:40–3:40 — Shortfall watchlist
**On screen:** Scroll to the watchlist table; hover the top row.

> "This is the part the desk asked for. The five largest shortfalls in the
> month — where actual generation most exceeded the forecast you procured
> against. Top of the list: half past six on the 8th of January — forecast
> said 4.7 gigawatts, wind delivered 9.2. That's a 4.4-gigawatt
> under-prediction, issued at 09:30 the previous morning — comfortably
> *before* your cutoff, so this is exactly the forecast you'd have used.
> Each row shows the delivery time, the forecast issue time, and the gap —
> full provenance, nothing hidden."

### 3:40–4:30 — Assistant and close
**On screen:** Open the assistant sidebar; click a suggested question like
"How reliable is the matched-period coverage?" or ask "What was the worst
under-forecast and when?" Show the grounded answer.

> "And because a dashboard should answer questions, not just raise them, the
> built-in assistant is grounded in this exact dataset — ask it what the bias
> means for your position and it answers from the numbers on screen, nothing
> else. To be clear about scope: this pilot is an analysis aid, not a dispatch
> recommendation — but it quantifies the risk your desk carries into every
> day-ahead decision, using only Elexon data, fully reproducible. We'll show
> you exactly how it works next."

---

## Part 2 — Technical review (~4:30 target, hard cap 5:00)

Goal: make review easy, show the architecture and practices.

### 0:00–0:40 — Architecture overview
**On screen:** README repository map, or the docker-compose.yml file.

> "Two services: a React front end and a FastAPI back end, wired together with
> Docker Compose — one command, `./start.sh`, runs the whole stack. The front
> end talks to a single analysis endpoint; the back end owns all data
> sourcing. Nginx serves the static build and reverse-proxies `/api` to the
> backend, which is also how it deploys."

### 0:40–1:50 — Data pipeline
**On screen:** `backend/main.py` — scroll through `fetch_records` and
`analyse_wind`.

> "The backend pulls two Elexon datasets: FUELHH filtered to WIND for
> half-hourly actuals, and WINDFOR for forecasts, chunked into seven-day
> windows per the API's limit and fetched concurrently. The core logic is the
> decision-time reconstruction: for each delivery period we compute a D-1
> cutoff — 11 a.m. UK time the previous calendar day — using proper timezone
> rules so it's correct across daylight-saving changes, and we keep only the
> latest forecast issued before that cutoff. One subtlety: WINDFOR publishes
> at hourly resolution while actuals are half-hourly, so each hourly forecast
> is applied to both settlement periods in its delivery hour — that's what
> gets us to 100% coverage of January rather than half. No interpolation, no
> filling — coverage is reported honestly."

### 1:50–2:40 — Metrics and API contract
**On screen:** the metrics block in `analyse_wind`, then the live API JSON
in a second tab (http://localhost:18000/api/wind-analysis).

> "The endpoint returns metrics, metadata, the matched chart series with each
> forecast's publish time for provenance, and the top-five shortfall list.
> MAE, MAPE excluding zero-actual periods where percentage error is
> undefined, signed bias, and matched coverage against expected periods."

### 2:40–3:30 — Front end and assistant
**On screen:** `frontend/src/App.jsx` briefly, then the browser assistant.

> "The front end is a single React dashboard built with Vite and Recharts,
> styled as a dense trading-desk interface. The assistant is a second
> endpoint: the client sends its question plus a compact snapshot of the
> current dashboard state; the backend sanitizes and bounds that context,
> pins Gemini to a strict domain system prompt, and returns a plain answer.
> If the API key isn't configured, the endpoint returns 503 and the UI
> degrades gracefully — the core product never depends on it."

### 3:30–4:30 — Engineering practices and close
**On screen:** run `cd backend && python -m unittest -v` in the terminal —
15 tests pass in a fraction of a second. Show Dockerfile/compose briefly.

> "On practices: the matching logic is unit-tested — cutoff selection,
> timezone handling, hour-to-settlement-period mapping, partial coverage,
> shortfall ordering, and the assistant's error paths. Everything is pinned:
> a lockfile for the front end, fixed requirements for the back end, and both
> Dockerfiles build the same artifacts we've verified locally. Deployment is
> configured for Vercel on the front end and a containerized Heroku back end
> — the README covers both. Known limitations are documented too: the 11 a.m.
> D-1 cutoff is an assumption to confirm against the real desk deadline, and
> the analysis is national-level wind only. That's the tour — the repo has
> the full detail."

---

## Recording checklist
- [ ] `./start.sh` running; dashboard loads January 2026 with 1,488/1,488 coverage
- [ ] Numbers on screen match the script (MAE ≈ 2,126 MW, MAPE ≈ 22.1%, bias ≈ +1,840 MW)
- [ ] Watchlist top row: 8 Jan 18:30, gap ≈ 4,450 MW
- [ ] Backend tests run visibly: `cd backend && source .venv/bin/activate && python -m unittest -v`
- [ ] Total length ≤ 10:00 before upload; set YouTube visibility to **Unlisted**
- [ ] Open the video URL in an incognito window to confirm access before submitting
