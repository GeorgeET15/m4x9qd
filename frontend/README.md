# Northstar frontend

The React/Vite dashboard for the Northstar UK day-ahead wind pilot. It calls the FastAPI service at `/api/wind-analysis`, plots matched actual/forecast intervals, and shows accuracy and coverage summaries.

From this directory:

```bash
npm ci
npm run dev
npm run lint
npm run build
```

For the complete application setup, Docker instructions, API behavior, and deployment configuration, see the repository [README](../README.md).
