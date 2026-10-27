# Northstar | UK Day-Ahead Wind Desk

A React and FastAPI pilot dashboard for comparing UK national wind outturn with the latest Elexon WINDFOR forecast available before a stated day-ahead decision cutoff. The default review window is January 2026.

Public source repository: [github.com/GeorgeET15/m4x9qd](https://github.com/GeorgeET15/m4x9qd).

The app is an analysis aid, not a dispatch or trading recommendation. It uses only Elexon BMRS `FUELHH` (filtered to `fuelType=WIND`) and `WINDFOR`.

## What the dashboard shows

- **MAE**: average absolute forecast error in MW.
- **MAPE**: mean absolute percentage error. Periods with zero actual generation are excluded because percentage error is undefined at zero.
- **Bias**: mean forecast minus actual in MW; positive values mean over-forecasting.
- **Matched coverage**: the number of actual intervals with an eligible, exactly timestamp-matched forecast divided by valid actual intervals.
- A time-series comparison and the five largest positive actual-minus-forecast periods. Each point in the watchlist includes the publication time of the forecast used for that delivery period.

The selection rule is explicit: for each delivery `startTime`, select the latest forecast `publishTime` at or before **11:00 Europe/London on the previous calendar day**. This cutoff is an assumption for the pilot and should be confirmed with the client's actual market/desk decision deadline before operational use. The backend uses UK calendar days and timezone rules, including daylight-saving changes. It does not interpolate, fill, or aggregate mismatched intervals; coverage shows the impact of missing overlaps.

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
│   ├── package.json        # React, Vite, Recharts and scripts
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
├── Dockerfile.heroku       # Heroku backend image, built from the repo root
├── .gitignore              # Excludes local environments, builds and secrets
└── heroku.yml              # Heroku container definition for the backend
```

## Run locally

### Full application with Docker

From the repository root:

```bash
docker compose up --build
```

Open [http://localhost:18080](http://localhost:18080). The API is available at [http://localhost:18000/api/wind-analysis](http://localhost:18000/api/wind-analysis), and its health check is [http://localhost:18000/health](http://localhost:18000/health). The frontend's Nginx proxy forwards `/api/` requests to the backend container. If either host port is occupied, set `WEB_PORT` or `API_PORT` when starting Compose.

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

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to `http://localhost:8000`. For a separately hosted API, set `VITE_API_URL` to its full `/api/wind-analysis` URL before building, for example:

```bash
VITE_API_URL=https://your-backend.example/api/wind-analysis npm run build
```

## API

`GET /api/wind-analysis` accepts optional ISO date query parameters:

```text
/api/wind-analysis?start_date=2026-01-01&end_date=2026-01-31
```

The default dates are `2026-01-01` through `2026-01-31`. The response contains `metrics`, `metadata` (including selected forecast coverage and the latest included publication time), and `chart_data` (including each selected forecast publication time).

## Verification

```bash
cd backend
python -m unittest -v

cd ../frontend
npm run lint
npm run build
```

## Deployment

The frontend is configured for Vercel (`frontend/` as the project root). Set `VITE_API_URL` to the deployed backend's `/api/wind-analysis` URL in the Vercel project settings.

The backend has a Dockerfile and `heroku.yml`. Configure `CORS_ORIGINS` on the backend to the exact deployed frontend origin (comma-separated if multiple origins are needed). The current default `*` is convenient for local pilot use and should be replaced for deployment.

For a Heroku backend, create an app, select the container stack, add its Git remote, and push the `main` branch:

```bash
heroku create <backend-app-name>
heroku stack:set container -a <backend-app-name>
heroku git:remote -a <backend-app-name>
git push heroku main
```

Then set `CORS_ORIGINS` to the Vercel frontend origin and set Vercel's `VITE_API_URL` to `https://<backend-app-name>.herokuapp.com/api/wind-analysis`:

```bash
heroku config:set CORS_ORIGINS=https://<your-frontend>.vercel.app -a <backend-app-name>
```

**No public deployment URL is available yet.** Deployment requires access to the client's or submitter's hosting accounts; this workspace contains deploy configuration but cannot create or authorize those accounts.

## Demo run-of-show

The requested unlisted YouTube recording still needs to be recorded and uploaded by an account owner. A concise, under-10-minute walkthrough can use this split:

1. **Client pitch (about 4 minutes):** frame the D-1 wind volume risk; show MAE, MAPE, bias and match coverage; compare forecast with outturn; inspect the largest forecast shortfalls and their issue times; close by explaining that the pilot uses historical national wind only and does not recommend a trade.
2. **Technical review (about 4 minutes):** trace the React dashboard through the FastAPI endpoint to Elexon `FUELHH` and `WINDFOR`; explain the cutoff filtering and exact-time matching; explain metrics and known coverage limitation; show the unit tests and run the Docker Compose setup.

## AI tools

An AI assistant using Copilot SDK in VS Code assisted with implementation and documentation. The data-selection logic and its tests were reviewed and run as part of development.
