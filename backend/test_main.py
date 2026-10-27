import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.genai.errors import APIError

from main import (
    ASSISTANT_SYSTEM_PROMPT,
    GEMINI_MODEL,
    analyse_wind,
    app,
    fetch_records,
)


class AskAssistantTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.payload = {
            "question": "What is the forecast bias?",
            "context": {
                "metrics": {
                    "mae": 1839.920698,
                    "bias": 125.0,
                    "matched_coverage": {"matched": 744, "expected": 1488},
                },
                "shortfalls": [
                    {
                        "delivery_time": "2026-01-08T19:00:00Z",
                        "forecast_publish_time": "2026-01-07T11:00:00Z",
                        "outturn": 9880,
                        "forecast": 5913,
                        "gap": 3967,
                    },
                ],
                "chart_data_summary": {
                    "matched_periods": 744,
                    "actual_generation_mw": {"mean_mw": 1839.920698},
                },
            },
        }

    def test_missing_api_key_returns_service_unavailable(self):
        with patch.dict("os.environ", {}, clear=True):
            response = self.client.post("/api/ask-assistant", json=self.payload)

        self.assertEqual(response.status_code, 503)
        self.assertIn("GEMINI_API_KEY", response.json()["detail"])

    def test_question_and_dashboard_context_are_sent_to_gemini(self):
        generate_content = AsyncMock(return_value=SimpleNamespace(text="Bias is 125 MW."))
        close = AsyncMock()
        fake_client = SimpleNamespace(
            aio=SimpleNamespace(
                models=SimpleNamespace(generate_content=generate_content),
                aclose=close,
            )
        )
        with (
            patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}),
            patch("main.genai.Client", return_value=fake_client),
        ):
            response = self.client.post("/api/ask-assistant", json=self.payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"answer": "Bias is 125 MW."})
        kwargs = generate_content.await_args.kwargs
        self.assertEqual(kwargs["model"], GEMINI_MODEL)
        self.assertIn(self.payload["question"], kwargs["contents"])
        self.assertIn('"mae":1839.9', kwargs["contents"])
        self.assertIn('"mean_mw":1839.9', kwargs["contents"])
        self.assertNotIn("1839.920698", kwargs["contents"])
        self.assertIn(
            "Jan 08 19:00 UK: Actual 9,880 MW, Forecast 5,913 MW, Gap +3,967 MW",
            kwargs["contents"],
        )
        self.assertIn("forecast published Jan 07 11:00 UK", kwargs["contents"])
        self.assertEqual(
            kwargs["config"].system_instruction,
            ASSISTANT_SYSTEM_PROMPT,
        )
        self.assertIn("CRITICAL DOMAIN KNOWLEDGE", kwargs["config"].system_instruction)
        self.assertIn("Query outside current dashboard context.", kwargs["config"].system_instruction)
        close.assert_awaited_once()

    def test_gemini_api_error_returns_structured_retry_message(self):
        generate_content = AsyncMock(
            side_effect=APIError(500, {"message": "provider failure"})
        )
        close = AsyncMock()
        fake_client = SimpleNamespace(
            aio=SimpleNamespace(
                models=SimpleNamespace(generate_content=generate_content),
                aclose=close,
            )
        )
        with (
            patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}),
            patch("main.genai.Client", return_value=fake_client),
        ):
            response = self.client.post("/api/ask-assistant", json=self.payload)

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json(),
            {"response": "Error: Unable to reach data model. Please try again."},
        )
        close.assert_awaited_once()

    def test_gemini_timeout_returns_structured_retry_message(self):
        generate_content = AsyncMock(side_effect=TimeoutError())
        close = AsyncMock()
        fake_client = SimpleNamespace(
            aio=SimpleNamespace(
                models=SimpleNamespace(generate_content=generate_content),
                aclose=close,
            )
        )
        with (
            patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}),
            patch("main.genai.Client", return_value=fake_client),
        ):
            response = self.client.post("/api/ask-assistant", json=self.payload)

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json(),
            {"response": "Error: Unable to reach data model. Please try again."},
        )
        close.assert_awaited_once()

    def test_invalid_request_payload_is_rejected(self):
        response = self.client.post(
            "/api/ask-assistant",
            json={"question": "", "context": self.payload["context"]},
        )

        self.assertEqual(response.status_code, 422)


class WindAnalysisTests(unittest.TestCase):
    def test_latest_forecast_before_uk_deadline_and_zero_actual(self):
        actual = [
            {"fuelType": "WIND", "startTime": "2026-01-02T12:00:00Z",
             "publishTime": "2026-01-02T12:30:00Z", "generation": 100},
            {"fuelType": "WIND", "startTime": "2026-01-02T13:00:00Z",
             "publishTime": "2026-01-02T13:30:00Z", "generation": 0},
            {"fuelType": "SOLAR", "startTime": "2026-01-02T12:00:00Z",
             "publishTime": "2026-01-02T12:30:00Z", "generation": 500},
        ]
        forecasts = [
            {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T09:00:00Z",
             "generation": 60},
            {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T11:00:00Z",
             "generation": 80},
            {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T11:01:00Z",
             "generation": 100},
            {"startTime": "2026-01-02T13:00:00Z", "publishTime": "2026-01-01T10:00:00Z",
             "generation": 10},
        ]
        result = analyse_wind(actual, forecasts, date(2026, 1, 2), date(2026, 1, 2))
        self.assertEqual(result["metrics"], {
            "mae": 15.0,
            "mape": 20.0,
            "bias": -5.0,
            "matched_coverage": {"matched": 2, "expected": 48},
        })
        self.assertEqual(result["metadata"], {
            "start_date": "2026-01-02",
            "end_date": "2026-01-02",
            "decision_cutoff": "11:00 Europe/London on D-1",
            "actual_points": 2,
            "matched_points": 2,
            "expected_points": 48,
            "coverage_pct": 100.0,
            "mape_sample_count": 1,
            "latest_forecast_publish_time": "2026-01-01T11:00:00Z",
        })
        self.assertEqual(result["chart_data"], [
            {"startTime": "2026-01-02T12:00:00Z", "actual_generation": 100.0,
             "forecast_generation": 80.0, "forecast_publish_time": "2026-01-01T11:00:00Z"},
            {"startTime": "2026-01-02T13:00:00Z", "actual_generation": 0.0,
             "forecast_generation": 10.0, "forecast_publish_time": "2026-01-01T10:00:00Z"},
        ])
        self.assertEqual(result["shortfalls"], [{
            "delivery_time": "2026-01-02T12:00:00Z",
            "forecast_publish_time": "2026-01-01T11:00:00Z",
            "outturn": 100.0,
            "forecast": 80.0,
            "gap": 20.0,
        }])

    def test_shortfalls_are_strictly_positive_sorted_and_limited_to_five(self):
        actual = [
            {
                "fuelType": "WIND",
                "startTime": f"2026-01-02T{12 + index // 2:02d}:{(index % 2) * 30:02d}:00Z",
                "publishTime": "2026-01-02T16:00:00Z",
                "generation": 100 + index * 20,
            }
            for index in range(7)
        ]
        forecasts = [
            {
                "startTime": row["startTime"],
                "publishTime": "2026-01-01T10:00:00Z",
                "generation": 100,
            }
            for row in actual
        ]

        result = analyse_wind(actual, forecasts, date(2026, 1, 2), date(2026, 1, 2))

        self.assertEqual(result["metrics"]["matched_coverage"], {
            "matched": 7,
            "expected": 48,
        })
        self.assertEqual(
            [row["gap"] for row in result["shortfalls"]],
            [120.0, 100.0, 80.0, 60.0, 40.0],
        )
        self.assertEqual(
            [row["delivery_time"] for row in result["shortfalls"]],
            [
                "2026-01-02T15:00:00Z",
                "2026-01-02T14:30:00Z",
                "2026-01-02T14:00:00Z",
                "2026-01-02T13:30:00Z",
                "2026-01-02T13:00:00Z",
            ],
        )
        self.assertTrue(all(row["outturn"] > row["forecast"] for row in result["shortfalls"]))

    def test_dst_deadline_uses_uk_calendar_day(self):
        actual = [{"fuelType": "WIND", "startTime": "2026-03-30T11:00:00Z",
                   "publishTime": "2026-03-30T11:30:00Z", "generation": 100}]
        forecasts = [
            {"startTime": "2026-03-30T11:00:00Z", "publishTime": "2026-03-29T10:00:00Z",
             "generation": 90},
            {"startTime": "2026-03-30T11:00:00Z", "publishTime": "2026-03-29T10:01:00Z",
             "generation": 200},
        ]
        result = analyse_wind(actual, forecasts, date(2026, 3, 30), date(2026, 3, 30))
        self.assertEqual(result["metrics"], {
            "mae": 10.0,
            "mape": 10.0,
            "bias": -10.0,
            "matched_coverage": {"matched": 1, "expected": 48},
        })

    def test_empty_match_raises_not_found(self):
        with self.assertRaises(HTTPException) as error:
            analyse_wind([], [], date(2026, 1, 1), date(2026, 1, 1))
        self.assertEqual(error.exception.status_code, 404)

    def test_hourly_forecast_covers_both_half_hourly_periods(self):
        actual = [
            {"fuelType": "WIND", "startTime": "2026-01-02T12:00:00Z",
             "publishTime": "2026-01-02T12:30:00Z", "generation": 100},
            {"fuelType": "WIND", "startTime": "2026-01-02T12:30:00Z",
             "publishTime": "2026-01-02T13:00:00Z", "generation": 110},
        ]
        forecasts = [
            {"startTime": "2026-01-02T12:00:00Z", "publishTime": "2026-01-01T10:00:00Z",
             "generation": 90},
        ]

        result = analyse_wind(actual, forecasts, date(2026, 1, 2), date(2026, 1, 2))

        self.assertEqual(result["metadata"]["actual_points"], 2)
        self.assertEqual(result["metadata"]["matched_points"], 2)
        self.assertEqual(result["metadata"]["coverage_pct"], 100.0)

    def test_partial_forecast_coverage_is_reported_against_actuals(self):
        actual = [
            {"fuelType": "WIND", "startTime": "2026-01-02T12:30:00Z",
             "publishTime": "2026-01-02T13:00:00Z", "generation": 110},
            {"fuelType": "WIND", "startTime": "2026-01-02T13:30:00Z",
             "publishTime": "2026-01-02T14:00:00Z", "generation": 120},
        ]
        forecasts = [
            {"startTime": "2026-01-02T13:00:00Z", "publishTime": "2026-01-01T10:00:00Z",
             "generation": 90},
        ]

        result = analyse_wind(actual, forecasts, date(2026, 1, 2), date(2026, 1, 2))

        self.assertEqual(result["metadata"]["actual_points"], 2)
        self.assertEqual(result["metadata"]["matched_points"], 1)
        self.assertEqual(result["metadata"]["coverage_pct"], 50.0)

    def test_reversed_date_range_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            analyse_wind([], [], date(2026, 1, 2), date(2026, 1, 1))
        self.assertEqual(error.exception.status_code, 422)


class FetchRecordsTests(unittest.IsolatedAsyncioTestCase):
    async def test_chunks_observe_bmrs_seven_day_limit(self):
        class Response:
            def raise_for_status(self):
                pass

            def json(self):
                return {"data": [{"generation": 1}]}

        class Client:
            def __init__(self):
                self.calls = []

            async def get(self, url, params):
                self.calls.append(params)
                return Response()

        client = Client()
        records = await fetch_records(
            client, "WINDFOR", datetime(2026, 1, 1, tzinfo=timezone.utc),
            datetime(2026, 1, 15, tzinfo=timezone.utc), "publishDateTime",
        )
        self.assertEqual(len(records), 3)
        self.assertEqual([call["publishDateTimeTo"] for call in client.calls],
                         ["2026-01-07T00:00:00Z", "2026-01-13T00:00:00Z",
                          "2026-01-15T00:00:00Z"])

    async def test_settlement_date_queries_use_date_values(self):
        class Response:
            def raise_for_status(self):
                pass

            def json(self):
                return {"data": []}

        class Client:
            def __init__(self):
                self.calls = []

            async def get(self, url, params):
                self.calls.append(params)
                return Response()

        client = Client()
        await fetch_records(
            client, "FUELHH", date(2026, 1, 1), date(2026, 1, 8),
            "settlementDate", {"fuelType": "WIND"},
        )
        self.assertEqual(client.calls, [
            {
                "settlementDateFrom": "2026-01-01",
                "settlementDateTo": "2026-01-06",
                "fuelType": "WIND",
            },
            {
                "settlementDateFrom": "2026-01-07",
                "settlementDateTo": "2026-01-07",
                "fuelType": "WIND",
            },
        ])

    async def test_invalid_bmrs_payload_is_reported_as_bad_gateway(self):
        class Response:
            def raise_for_status(self):
                pass

            def json(self):
                raise ValueError("not JSON")

        class Client:
            async def get(self, url, params):
                return Response()

        with self.assertRaises(HTTPException) as error:
            await fetch_records(
                Client(), "WINDFOR", datetime(2026, 1, 1, tzinfo=timezone.utc),
                datetime(2026, 1, 2, tzinfo=timezone.utc), "publishDateTime",
            )
        self.assertEqual(error.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
