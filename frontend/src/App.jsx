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

function validateAnalysisPayload(data) {
  const hasMetrics =
    Number.isFinite(data?.metrics?.mae) &&
    Number.isFinite(data?.metrics?.mape) &&
    Number.isFinite(data?.metrics?.bias)
  const hasCoverage =
    Number.isFinite(data?.metadata?.matched_points) &&
    Number.isFinite(data?.metadata?.actual_points) &&
    Number.isFinite(data?.metadata?.coverage_pct)

  if (!hasMetrics || !hasCoverage || !Array.isArray(data?.chart_data)) {
    throw new Error(
      'The backend response is missing bias or coverage data. Rebuild and restart the backend to load the updated API.',
    )
  }
  return data
}

function getAnalysisErrorMessage(error) {
  if (error.response?.data?.detail) return error.response.data.detail
  if (error.message?.startsWith('The backend response is missing')) return error.message
  return 'The wind analysis service is unavailable. Check the backend connection and try again.'
}

function MetricReadout({ label, value, unit, detail, className = '' }) {
  return (
    <div className={`metric-readout ${className}`}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">
        {value}
        {unit && <span>{unit}</span>}
      </p>
      <p className="metric-detail">{detail}</p>
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16.2 8a6.4 6.4 0 0 0-11.1-2L3.5 7.5" />
      <path d="M3.5 3.8v3.7h3.7M3.8 12a6.4 6.4 0 0 0 11.1 2l1.6-1.5" />
      <path d="M16.5 16.2v-3.7h-3.7" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9 2.5h4.5V7M13.2 2.8 7.5 8.5" />
      <path d="M12 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" />
    </svg>
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
      const data = validateAnalysisPayload(response.data)
      setChartData(data.chart_data)
      setMetrics(data.metrics)
      setMetadata(data.metadata)
      setError(null)
      setLastUpdated(new Date())
    } catch (requestError) {
      setError(getAnalysisErrorMessage(requestError))
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
        const data = validateAnalysisPayload(response.data)
        setChartData(data.chart_data)
        setMetrics(data.metrics)
        setMetadata(data.metadata)
        setError(null)
        setLastUpdated(new Date())
      })
      .catch((requestError) => {
        if (!active) return
        setError(getAnalysisErrorMessage(requestError))
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
              <span className={loading ? 'refresh-icon is-loading' : 'refresh-icon'}>
                <RefreshIcon />
              </span>
              {loading ? 'Updating' : 'Refresh data'}
            </button>
          </div>
        </header>

        <section className="hero">
          <div>
            <h1>Wind forecast accuracy</h1>
            <p className="hero-copy">
              A decision-time view of Elexon’s national wind forecast against
              realised generation.
            </p>
          </div>
          <div className="period-panel">
            <span className="period-label">Delivery window</span>
            <time dateTime="2026-01">01—31 Jan 2026</time>
            <span className="period-meta">Great Britain · all times UK</span>
          </div>
        </section>

        {loading && !metrics ? (
          <section className="loading-panel" aria-live="polite" role="status">
            <p>Loading January wind data from Elexon…</p>
            <div className="loading-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
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

            <section className="metrics-strip" aria-label="Forecast accuracy metrics">
              <MetricReadout
                label="Mean absolute error"
                value={formatMetric(metrics?.mae)}
                unit="MW"
                detail="Per matched timestamp"
                className="primary-metric"
              />
              <MetricReadout
                label="Mean absolute percentage error"
                value={formatMetric(metrics?.mape)}
                unit="%"
                detail={`${formatNumber(metadata?.mape_sample_count)} non-zero actuals`}
              />
              <MetricReadout
                label="Forecast bias"
                value={formatMetric(metrics?.bias)}
                unit="MW"
                detail="Forecast − actual · positive is over-forecast"
              />
              <MetricReadout
                label="Matched coverage"
                value={coverage}
                unit=""
                detail={`${formatMetric(metadata?.coverage_pct)}% exact matches`}
              />
            </section>

            <section className="analysis-grid">
              <article className="panel chart-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Forecast vs. outturn</h2>
                    <p className="panel-description">National wind generation · MW</p>
                  </div>
                  <span className="unit-tag">JAN 2026</span>
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
                          stroke="#e2ecef"
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
                          tick={{ fill: '#49616d', fontSize: 11 }}
                          tickLine={false}
                          axisLine={{ stroke: '#cbdde3' }}
                        />
                        <YAxis
                          width={58}
                          tickFormatter={formatNumber}
                          tick={{ fill: '#49616d', fontSize: 11 }}
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
                            color: '#49616d',
                            paddingBottom: '18px',
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual_generation"
                          name="Actual"
                          stroke="#087c67"
                          strokeWidth={2.5}
                          isAnimationActive={false}
                          dot={false}
                          activeDot={{ r: 4, fill: '#087c67', stroke: '#ffffff', strokeWidth: 2 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast_generation"
                          name="Day-ahead forecast"
                          stroke="#a96300"
                          strokeWidth={2.25}
                          strokeDasharray="4 5"
                          isAnimationActive={false}
                          dot={false}
                          activeDot={{ r: 4, fill: '#a96300', stroke: '#ffffff', strokeWidth: 2 }}
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
                    <h2>Where wind fell short</h2>
                    <p className="panel-description">
                      Largest outturn-above-forecast intervals
                    </p>
                  </div>
                  <span className="risk-tag">SHORTFALLS</span>
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
              <div>
                <h2>How to read this analysis</h2>
                <p>
                  We use the latest WINDFOR issue by the assumed{' '}
                  <b>11:00 UK D-1 cutoff</b>. Forecasts are hourly; FUELHH
                  actuals are half-hourly. Only exact timestamp overlaps are
                  scored—no interpolation. MAPE omits zero-actual periods.
                </p>
              </div>
              <a
                href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream"
                target="_blank"
                rel="noreferrer"
              >
                Elexon dataset documentation <ExternalLinkIcon />
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
