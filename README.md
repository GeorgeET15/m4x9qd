# Northstar | UK Day-Ahead Wind Desk

A React and FastAPI pilot dashboard for comparing UK national wind outturn with the latest Elexon WINDFOR forecast available before a stated day-ahead decision cutoff. The default review window is January 2026.

Public source repository: [github.com/GeorgeET15/m4x9qd](https://github.com/GeorgeET15/m4x9qd).

The app is an analysis aid, not a dispatch or trading recommendation. It uses only Elexon BMRS `FUELHH` (filtered to `fuelType=WIND`) and `WINDFOR`.

## What the dashboard shows

- **MAE**: average absolute forecast error in MW.
- **RMSE**: root mean squared error in MW. Like MAE, but larger misses weigh more heavily.
- **MAPE**: mean absolute percentage error. Periods with zero actual generation are excluded because percentage error is undefined at zero.
- **Bias**: mean forecast minus actual in MW; positive values mean over-forecasting.
- **Matched coverage**: the number of actual intervals whose delivery hour has an eligible forecast divided by valid actual intervals.
- A time-series comparison and the five largest positive actual-minus-forecast periods. Each point in the watchlist includes the publication time of the forecast used for that delivery period.
- A chat-style assistant sidebar for asking questions about the currently displayed metrics, shortfalls, and a summary of the chart data.

The selection rule is explicit: for each delivery `startTime`, select the latest forecast `publishTime` at or before **11:00 Europe/London on the previous calendar day**. This cutoff is an assumption for the pilot and should be confirmed with the client's actual market/desk decision deadline before operational use. The backend uses UK calendar days and timezone rules, including daylight-saving changes. WINDFOR forecasts are issued at hourly resolution, so each hourly forecast is applied to both half-hourly FUELHH settlement periods within that delivery hour; the backend does not interpolate or fill missing hours, and coverage shows the impact of uncovered delivery hours.

The optional `POST /api/ask-assistant` endpoint uses Google Gemini (`gemini-2.5-flash`) to answer questions from a request-supplied snapshot of dashboard metrics, shortfalls, and a chart-data summary. Set `GEMINI_API_KEY` in the environment to enable it. The backend loads the project-root `.env` file automatically (via `python-dotenv`), and Docker Compose also passes the variable through; without it, the endpoint responds with HTTP 503. The assistant does not fetch additional market data.

## Repository map

```text
.
├── .dockerignore          # Exclude local files from the Heroku Docker context
├── backend/
│   ├── .dockerignore       # Keep local environments out of the image
│   ├── Dockerfile          # FastAPI container
│   ├── main.py             # Elexon fetch, cutoff selection, metrics and API
│   ├── requirements.txt     # Python dependencies
│   └── test_main.py         # Selection, timezone, coverage and request tests
├── frontend/
│   ├── .dockerignore       # Exclude npm build output from the image context
│   ├── README.md           # Frontend development notes
│   ├── Dockerfile          # Vite build served by Nginx
│   ├── index.html          # App shell and browser metadata
│   ├── nginx.conf          # SPA routing and API reverse proxy
│   ├── vercel.json         # Vercel static build settings
│   ├── package.json        # React, Vite, Recharts and self-hosted IBM Plex Sans
│   ├── package-lock.json   # Reproducible frontend dependency versions
│   ├── vite.config.js      # React plugin and local /api proxy
│   ├── tailwind.config.js  # Tailwind content paths and theme
│   ├── postcss.config.js   # Tailwind and Autoprefixer processing
│   ├── public/             # Static favicon and icon sprite
│   └── src/
│       ├── App.jsx         # Dashboard, metrics, chart and watchlist
│       ├── index.css       # Responsive visual styling
│       ├── main.jsx        # React entry point
│       └── assets/         # Static image and starter assets
├── docker-compose.yml      # Runs the full application locally
├── start.sh                # One-command Docker Compose start script
├── Dockerfile.heroku       # Heroku backend image, built from the repo root
├── .gitignore              # Excludes local environments, builds and secrets
├── heroku.yml              # Heroku container definition for the backend
└── VIDEO_SCRIPT.md         # Timed, word-for-word demo recording script
```

## Run locally

### Full application with Docker

From the repository root:

```bash
./start.sh
```

The script builds and starts the frontend and backend in the background. Open [http://localhost:18080](http://localhost:18080). The API is available at [http://localhost:18000/api/wind-analysis](http://localhost:18000/api/wind-analysis), and its health check is [http://localhost:18000/health](http://localhost:18000/health). The frontend's Nginx proxy forwards `/api/` requests to the backend container. If either host port is occupied, set `WEB_PORT` or `API_PORT` before running the script. Put `GEMINI_API_KEY=your-google-ai-studio-api-key` in the project-root `.env` file to enable the assistant. Stop both services with `docker compose down`.

### Run services separately

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Frontend, in a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to `http://localhost:8000`. For a separately hosted API, set `VITE_API_URL` to the backend's API base path before building — the frontend appends `/wind-analysis` and `/ask-assistant` to it:

```bash
VITE_API_URL=https://your-backend.example/api npm run build
```

`VITE_API_URL` defaults to `/api` (same-origin). It must be the base path only — not the full `/api/wind-analysis` endpoint — or the request URLs will contain duplicated path segments.

## API

`GET /api/wind-analysis` accepts optional ISO date query parameters:

```text
/api/wind-analysis?start_date=2026-01-01&end_date=2026-01-31
```

The default dates are `2026-01-01` through `2026-01-31`. The response contains `metrics` (`mae`, `rmse`, `mape`, forecast `bias`, and `matched_coverage` with matched and expected period counts), `metadata` (including selected forecast coverage and the latest included publication time), `chart_data` (including each selected forecast publication time), and `shortfalls` (the five largest positive actual-minus-forecast gaps, with delivery and forecast publication times). Expected coverage is 48 half-hour periods per requested calendar day, or 1,488 for January 2026.

### Dashboard assistant

`POST /api/ask-assistant` accepts a question and the current dashboard context. The caller supplies `metrics`, `shortfalls`, and an aggregated `chart_data_summary`; the backend sends only that context and the question to Gemini.

```json
{
  "question": "What does the forecast bias indicate?",
  "context": {
    "metrics": {
      "bias": 125.0,
      "matched_coverage": {
        "matched": 744,
        "expected": 1488
      }
    },
    "shortfalls": [],
    "chart_data_summary": {
      "matched_periods": 744,
      "mean_actual_generation_mw": 8200,
      "mean_forecast_generation_mw": 8325
    }
  }
}
```

The success response is `{"answer":"..."}`. A missing `GEMINI_API_KEY` returns HTTP 503; Gemini or network request failures return HTTP 502. Questions are limited to 2,000 characters and serialized context to 50,000 characters.

## Verification

```bash
cd backend
python -m unittest -v

cd ../frontend
npm run lint
npm run build
```

## Deployment

The frontend is configured for Vercel (`frontend/` as the project root). Set `VITE_API_URL` to the deployed backend's API base path, `https://<backend-app-name>.herokuapp.com/api`, in the Vercel project settings.

The backend has a Dockerfile and `heroku.yml`. Configure `CORS_ORIGINS` on the backend to the exact deployed frontend origin (comma-separated if multiple origins are needed). The current default `*` is convenient for local pilot use and should be replaced for deployment.

For a Heroku backend, create an app, select the container stack, add its Git remote, and push the `main` branch:

```bash
heroku create <backend-app-name>
heroku stack:set container -a <backend-app-name>
heroku git:remote -a <backend-app-name>
git push heroku main
```

Then set `CORS_ORIGINS` to the Vercel frontend origin and set Vercel's `VITE_API_URL` to `https://<backend-app-name>.herokuapp.com/api`:

```bash
heroku config:set CORS_ORIGINS=https://<your-frontend>.vercel.app -a <backend-app-name>
```

**No public deployment URL is available yet.** Deployment requires access to the client's or submitter's hosting accounts; this workspace contains deploy configuration but cannot create or authorize those accounts.

## Demo run-of-show

The requested unlisted YouTube recording still needs to be recorded and uploaded by an account owner. [VIDEO_SCRIPT.md](VIDEO_SCRIPT.md) contains a fully timed, word-for-word script for both parts (client pitch and technical review) plus a recording checklist. In short:

1. **Client pitch (about 4 minutes):** frame the D-1 wind volume risk; show MAE, MAPE, bias and match coverage; compare forecast with outturn; inspect the largest forecast shortfalls and their issue times; close by explaining that the pilot uses historical national wind only and does not recommend a trade.
2. **Technical review (about 4 minutes):** trace the React dashboard through the FastAPI endpoint to Elexon `FUELHH` and `WINDFOR`; explain the cutoff filtering and delivery-hour matching; explain metrics and coverage; show the unit tests and run the Docker Compose setup.

## AI tools

AI tools assisted with implementation and documentation, including GitHub Copilot in VS Code and [Devin](https://devin.ai) (data-matching fix, verification, and the demo video script). Impeccable design guidance and its UI detector informed the dashboard redesign; IBM Plex Sans is self-hosted through Fontsource rather than fetched at runtime. The data-selection logic and its tests were reviewed and run as part of development.
