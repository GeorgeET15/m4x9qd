import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const API_URL = import.meta.env.VITE_API_URL || '/api/wind-analysis'
const START_DATE = '2026-01-01'
const END_DATE = '2026-01-31'
const UK_TIMEZONE = 'Europe/London'
const REQUEST_PARAMS = { start_date: START_DATE, end_date: END_DATE }

const numberFormatter = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 0,
})

const metricFormatter = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 1,
})

function formatNumber(value) {
  return Number.isFinite(value) ? numberFormatter.format(value) : '—'
}

function formatMetric(value) {
  return Number.isFinite(value) ? metricFormatter.format(value) : '—'
}

function formatUKTime(value, options = {}) {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: UK_TIMEZONE,
    ...options,
  })
}

function MetricCard({ label, value, unit, detail, accent }) {
  return (
    <article className="metric-card">
      <div className="metric-heading">
        <span className={`metric-dot ${accent}`} aria-hidden="true" />
        <h2>{label}</h2>
      </div>
      <p className="metric-value">
        {value}
        <span>{unit}</span>
      </p>
      <p className="metric-detail">{detail}</p>
    </article>
  )
}

function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  const point = payload[0].payload
  return (
    <div className="chart-tooltip">
      <strong>
        {formatUKTime(label, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </strong>
      {payload.map((series) => (
        <p key={series.dataKey} style={{ color: series.color }}>
          <span>{series.name}</span>
          <b>{formatNumber(series.value)} MW</b>
        </p>
      ))}
      <small>
        Forecast issued{' '}
        {formatUKTime(point.forecast_publish_time, {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}{' '}
        UK
      </small>
    </div>
  )
}

function App() {
  const [chartData, setChartData] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [metadata, setMetadata] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const loadAnalysis = useCallback(async () => {
    try {
      const response = await axios.get(API_URL, {
        params: REQUEST_PARAMS,
      })
      setChartData(response.data.chart_data)
      setMetrics(response.data.metrics)
      setMetadata(response.data.metadata)
      setError(null)
      setLastUpdated(new Date())
    } catch (requestError) {
      setError(
        requestError.response?.data?.detail ||
          'The wind analysis service is unavailable. Check the backend connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    axios
      .get(API_URL, { params: REQUEST_PARAMS })
      .then((response) => {
        if (!active) return
        setChartData(response.data.chart_data)
        setMetrics(response.data.metrics)
        setMetadata(response.data.metadata)
        setError(null)
        setLastUpdated(new Date())
      })
      .catch((requestError) => {
        if (!active) return
        setError(
          requestError.response?.data?.detail ||
            'The wind analysis service is unavailable. Check the backend connection and try again.',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const refreshAnalysis = () => {
    setLoading(true)
    loadAnalysis()
  }

  const tickInterval = useMemo(
    () => Math.max(Math.ceil(chartData.length / 10) - 1, 0),
    [chartData.length],
  )

  const underForecastPeriods = useMemo(
    () =>
      chartData
        .map((point) => ({
          ...point,
          shortfall: point.actual_generation - point.forecast_generation,
        }))
        .filter((point) => point.shortfall > 0)
        .sort((left, right) => right.shortfall - left.shortfall)
        .slice(0, 5),
    [chartData],
  )

  const coverage = metadata
    ? `${formatNumber(metadata.matched_points)} / ${formatNumber(metadata.actual_points)}`
    : '—'

  return (
    <main className="app-shell">
      <div className="dashboard">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              N
            </span>
            <span>
              <strong>northstar</strong>
              <small>ENERGY TRADING</small>
            </span>
          </div>
          <div className="topbar-right">
            <span className="live-indicator">
              <span aria-hidden="true" />
              ELEXON BMRS
            </span>
            <button
              className="refresh-button"
              onClick={refreshAnalysis}
              disabled={loading}
              type="button"
            >
              <span aria-hidden="true">{loading ? '…' : '↻'}</span>
              {loading ? 'Updating' : 'Refresh data'}
            </button>
          </div>
        </header>

        <section className="hero">
          <div>
            <p className="eyebrow">NATIONAL WIND · DAY-AHEAD DESK</p>
            <h1>Make the wind call<br />with confidence.</h1>
            <p className="hero-copy">
              See the forecast the desk could have used at decision time — and
              how closely it tracked the outturn.
            </p>
          </div>
          <div className="period-panel">
            <span className="period-label">REVIEW PERIOD</span>
            <strong>01 — 31 January 2026</strong>
            <span className="period-meta">Great Britain · 30-minute actuals</span>
            <span className="period-status">
              <span aria-hidden="true" />
              HISTORICAL ANALYSIS
            </span>
          </div>
        </section>

        {loading && !metrics ? (
          <section className="message-panel" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <p>Loading January wind data from Elexon…</p>
          </section>
        ) : error && !metrics ? (
          <section className="message-panel error-panel" role="alert">
            <div>
              <h2>Unable to load wind data</h2>
              <p>{error}</p>
            </div>
            <button className="retry-button" onClick={refreshAnalysis} type="button">
              Try again
            </button>
          </section>
        ) : (
          <>
            {error && (
              <div className="inline-error" role="alert">
                Data refresh failed: {error}. Showing the last successful
                response.
              </div>
            )}

            <section className="metrics-grid" aria-label="Forecast accuracy metrics">
              <MetricCard
                label="Mean absolute error"
                value={formatMetric(metrics?.mae)}
                unit="MW"
                detail="Average distance from the realised output"
                accent="green"
              />
              <MetricCard
                label="Mean absolute % error"
                value={formatMetric(metrics?.mape)}
                unit="%"
                detail={`Across ${formatNumber(metadata?.mape_sample_count)} non-zero intervals`}
                accent="blue"
              />
              <MetricCard
                label="Forecast bias"
                value={formatMetric(metrics?.bias)}
                unit="MW"
                detail="Forecast minus actual · positive means long"
                accent="amber"
              />
              <MetricCard
                label="Matched coverage"
                value={coverage}
                unit=""
                detail={`${formatMetric(metadata?.coverage_pct)}% exact timestamp matches`}
                accent="violet"
              />
            </section>

            <section className="analysis-grid">
              <article className="panel chart-panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">THE MONTH, IN MEGAWATTS</p>
                    <h2>Forecast vs. outturn</h2>
                    <p className="panel-description">
                      Elexon national wind · each eligible delivery interval
                    </p>
                  </div>
                  <span className="unit-tag">JAN ’26</span>
                </div>

                {chartData.length === 0 ? (
                  <div className="empty-chart">No matched periods to chart.</div>
                ) : (
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={chartData}
                        margin={{ top: 14, right: 12, bottom: 4, left: 0 }}
                      >
                        <CartesianGrid
                          stroke="#e8eeea"
                          strokeDasharray="2 6"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="startTime"
                          interval={tickInterval}
                          minTickGap={32}
                          tickFormatter={(value) =>
                            formatUKTime(value, { day: '2-digit', month: 'short' })
                          }
                          tick={{ fill: '#75827c', fontSize: 10 }}
                          tickLine={false}
                          axisLine={{ stroke: '#dce5df' }}
                        />
                        <YAxis
                          width={58}
                          tickFormatter={formatNumber}
                          tick={{ fill: '#75827c', fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip content={<ForecastTooltip />} />
                        <Legend
                          align="right"
                          verticalAlign="top"
                          iconType="circle"
                          iconSize={7}
                          wrapperStyle={{
                            fontSize: '12px',
                            color: '#596970',
                            paddingBottom: '18px',
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual_generation"
                          name="Actual"
                          stroke="#1b7a59"
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={{ r: 4, fill: '#1b7a59', stroke: '#fff', strokeWidth: 2 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast_generation"
                          name="Day-ahead forecast"
                          stroke="#7383ae"
                          strokeWidth={2.25}
                          strokeDasharray="4 5"
                          dot={false}
                          activeDot={{ r: 4, fill: '#7383ae', stroke: '#fff', strokeWidth: 2 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="chart-footnote">
                  <span>
                    {formatNumber(metadata?.matched_points)} matched delivery
                    periods
                  </span>
                  <span>
                    Latest selected issue:{' '}
                    <strong>
                      {metadata?.latest_forecast_publish_time
                        ? formatUKTime(metadata.latest_forecast_publish_time, {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </strong>{' '}
                    UK time
                  </span>
                </div>
              </article>

              <article className="panel watchlist-panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">VOLUME RISK SIGNAL</p>
                    <h2>Where wind fell short</h2>
                    <p className="panel-description">
                      Biggest positive outturn-minus-forecast gaps
                    </p>
                  </div>
                  <span className="watchlist-icon" aria-hidden="true">
                    !
                  </span>
                </div>

                {underForecastPeriods.length === 0 ? (
                  <div className="empty-watchlist">
                    No forecast shortfalls in the matched periods.
                  </div>
                ) : (
                  <div className="watchlist-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>DELIVERY (UK)</th>
                          <th>OUTTURN</th>
                          <th>FORECAST</th>
                          <th>GAP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {underForecastPeriods.map((point) => (
                          <tr key={point.startTime}>
                            <td>
                              <strong>
                                {formatUKTime(point.startTime, {
                                  day: '2-digit',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </strong>
                              <small>
                                Issued{' '}
                                {formatUKTime(point.forecast_publish_time, {
                                  day: '2-digit',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </small>
                            </td>
                            <td>{formatNumber(point.actual_generation)}</td>
                            <td>{formatNumber(point.forecast_generation)}</td>
                            <td className="shortfall">
                              +{formatNumber(point.shortfall)} MW
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="watchlist-note">
                  Largest positive actual-minus-forecast differences. This is a
                  forecast-risk signal, not a dispatch recommendation.
                </p>
              </article>
            </section>

            <section className="method-strip">
              <div className="method-icon" aria-hidden="true">
                i
              </div>
              <div>
                <strong>Decision-time method</strong>
                <p>
                  For each delivery interval, we select the latest WINDFOR issue
                  published before the assumed <b>11:00 UK D-1 cutoff</b>.
                  Elexon forecasts are hourly while FUELHH actuals are
                  half-hourly, so this pilot scores exact timestamp overlaps
                  only—no interpolation. MAPE excludes zero-actual periods.
                </p>
              </div>
              <a
                href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream"
                target="_blank"
                rel="noreferrer"
              >
                Elexon dataset docs <span aria-hidden="true">↗</span>
              </a>
            </section>
          </>
        )}

        <footer className="page-footer">
          <span>
            Source: Elexon BMRS · FUELHH (WIND) and WINDFOR · January 2026
          </span>
          <span>
            {lastUpdated
              ? `Last refreshed ${formatUKTime(lastUpdated, {
                  hour: '2-digit',
                  minute: '2-digit',
                })} UK`
              : 'All times shown in UK local time'}
          </span>
        </footer>
      </div>
    </main>
  )
}

export default App
