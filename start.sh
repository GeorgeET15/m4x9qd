#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install or start Docker Desktop, then try again." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is required. Install or enable the Compose plugin, then try again." >&2
  exit 1
fi

docker compose up --build -d

echo
echo "Northstar is starting."
echo "Dashboard: http://localhost:${WEB_PORT:-18080}"
echo "API:       http://localhost:${API_PORT:-18000}/api/wind-analysis"
echo "Stop with: docker compose down"
echo "The assistant needs GEMINI_API_KEY in the project-root .env file."
