import asyncio
import os
from datetime import date, datetime, timedelta, timezone

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

BMRS_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
UK_TIMEZONE = "Europe/London"


def _date_string(value):
    return (value.date() if isinstance(value, datetime) else value).isoformat()


@app.get("/health")
async def health():
    return {"status": "ok"}


async def fetch_records(client, dataset, start, end, date_filter, extra=None):
    requests = []
    current = start
    while current < end:
        next_date = min(current + timedelta(days=6), end)
        last_date = next_date - timedelta(days=1) if date_filter == "settlementDate" else next_date
        if date_filter == "settlementDate":
            date_from = _date_string(current)
            date_to = _date_string(last_date)
        else:
            date_from = current.isoformat().replace("+00:00", "Z")
            date_to = last_date.isoformat().replace("+00:00", "Z")
        params = {f"{date_filter}From": date_from, f"{date_filter}To": date_to, **(extra or {})}
        requests.append(client.get(f"{BMRS_URL}/{dataset}", params=params))
        current = next_date
    responses = await asyncio.gather(*requests)
    records = []
    for response in responses:
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Invalid response from BMRS {dataset}",
            ) from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise HTTPException(status_code=502, detail=f"Unexpected response from BMRS {dataset}")
        records.extend(payload["data"])
    return records


def analyse_wind(actual_records, forecast_records, start_date, end_date):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not precede start_date")

    actual = pd.DataFrame(actual_records)
    forecast = pd.DataFrame(forecast_records)
    if actual.empty:
        raise HTTPException(status_code=404, detail="No actual wind generation data for this period")
    if forecast.empty:
        raise HTTPException(status_code=404, detail="No wind forecasts for this period")

    required_actual = {"fuelType", "startTime", "publishTime", "generation"}
    required_forecast = {"startTime", "publishTime", "generation"}
    if not required_actual.issubset(actual.columns) or not required_forecast.issubset(forecast.columns):
        raise HTTPException(status_code=502, detail="BMRS response is missing required wind data fields")

    actual = actual.loc[actual["fuelType"] == "WIND"].copy()
    actual["startTime"] = pd.to_datetime(actual["startTime"], utc=True)
    actual["publishTime"] = pd.to_datetime(actual["publishTime"], utc=True)
    actual["generation"] = pd.to_numeric(actual["generation"], errors="coerce")
    actual = actual.loc[actual["startTime"].dt.tz_convert(UK_TIMEZONE).dt.date.between(start_date, end_date)]
    actual = actual.dropna(subset=["startTime", "generation"])
    actual = actual.sort_values("publishTime").drop_duplicates("startTime", keep="last")

    forecast["startTime"] = pd.to_datetime(forecast["startTime"], utc=True)
    forecast["publishTime"] = pd.to_datetime(forecast["publishTime"], utc=True)
    forecast["generation"] = pd.to_numeric(forecast["generation"], errors="coerce")
    forecast = forecast.dropna(subset=["startTime", "publishTime", "generation"])
    local_delivery = forecast["startTime"].dt.tz_convert(UK_TIMEZONE).dt.tz_localize(None)
    forecast["da_deadline"] = (
        local_delivery.dt.normalize() - pd.Timedelta(days=1) + pd.Timedelta(hours=11)
    ).dt.tz_localize(UK_TIMEZONE).dt.tz_convert("UTC")
    forecast = forecast.loc[forecast["publishTime"] <= forecast["da_deadline"]]
    forecast = forecast.sort_values("publishTime").drop_duplicates("startTime", keep="last")

    actual_point_count = len(actual)
    merged = actual.merge(forecast, on="startTime", suffixes=("_actual", "_forecast"))
    if merged.empty:
        raise HTTPException(
            status_code=404,
            detail="No actual generation intervals have an eligible Day-Ahead forecast",
        )

    merged = merged.sort_values("startTime")
    error = (merged["generation_actual"] - merged["generation_forecast"]).abs()
    nonzero = merged["generation_actual"] != 0
    latest_publish_time = merged["publishTime_forecast"].max()
    coverage_pct = len(merged) / actual_point_count * 100 if actual_point_count else 0
    return {
        "metrics": {
            "mae": float(error.mean()),
            "mape": float((error[nonzero] / merged.loc[nonzero, "generation_actual"].abs()).mean() * 100)
            if nonzero.any()
            else 0.0,
            "bias": float((merged["generation_forecast"] - merged["generation_actual"]).mean()),
        },
        "metadata": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "decision_cutoff": "11:00 Europe/London on D-1",
            "actual_points": actual_point_count,
            "matched_points": len(merged),
            "coverage_pct": coverage_pct,
            "mape_sample_count": int(nonzero.sum()),
            "latest_forecast_publish_time": latest_publish_time.isoformat().replace("+00:00", "Z"),
        },
        "chart_data": [
            {
                "startTime": row.startTime.isoformat().replace("+00:00", "Z"),
                "actual_generation": float(row.generation_actual),
                "forecast_generation": float(row.generation_forecast),
                "forecast_publish_time": row.publishTime_forecast.isoformat().replace("+00:00", "Z"),
            }
            for row in merged.itertuples()
        ],
    }


@app.get("/api/wind-analysis")
async def wind_analysis(start_date: date = date(2026, 1, 1), end_date: date = date(2026, 1, 31)):
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must not precede start_date")

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            actual, forecast = await asyncio.gather(
                fetch_records(
                    client, "FUELHH", start_date, end_date + timedelta(days=1),
                    "settlementDate", {"fuelType": "WIND"},
                ),
                fetch_records(
                    client, "WINDFOR",
                    datetime.combine(start_date - timedelta(days=2), datetime.min.time(), timezone.utc),
                    datetime.combine(end_date + timedelta(days=1), datetime.min.time(), timezone.utc),
                    "publishDateTime",
                ),
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="BMRS data unavailable") from exc
    return analyse_wind(actual, forecast, start_date, end_date)
