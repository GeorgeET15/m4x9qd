import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const API_URL = import.meta.env.VITE_API_URL || '/api/wind-analysis'
const ASSISTANT_API_URL = '/api/ask-assistant'
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

function summarizeChartData(data) {
  const summarizeSeries = (key) => {
    const values = data.map((point) => point[key]).filter(Number.isFinite)
    if (!values.length) {
      return { mean_mw: null, min_mw: null, max_mw: null }
    }

    return {
      mean_mw: values.reduce((sum, value) => sum + value, 0) / values.length,
      min_mw: Math.min(...values),
      max_mw: Math.max(...values),
    }
  }

  return {
    matched_periods: data.length,
    delivery_start: data[0]?.startTime ?? null,
    delivery_end: data.at(-1)?.startTime ?? null,
    actual_generation_mw: summarizeSeries('actual_generation'),
    forecast_generation_mw: summarizeSeries('forecast_generation'),
  }
}

function validateAnalysisPayload(data) {
  const hasMetrics =
    Number.isFinite(data?.metrics?.mae) &&
    Number.isFinite(data?.metrics?.mape) &&
    Number.isFinite(data?.metrics?.bias)
  const hasCoverage =
    Number.isFinite(data?.metrics?.matched_coverage?.matched) &&
    Number.isFinite(data?.metrics?.matched_coverage?.expected) &&
    Number.isFinite(data?.metadata?.mape_sample_count)

  if (
    !hasMetrics ||
    !hasCoverage ||
    !Array.isArray(data?.chart_data) ||
    !Array.isArray(data?.shortfalls)
  ) {
    throw new Error(
      'The backend response is missing forecast coverage or shortfall data. Rebuild and restart the backend to load the updated API.',
    )
  }
  return data
}

function getAnalysisErrorMessage(error) {
  if (error.response?.data?.detail) return error.response.data.detail
  if (error.message?.startsWith('The backend response is missing')) return error.message
  return 'The wind analysis service is unavailable. Check the backend connection and try again.'
}

function MetricReadout({ label, value, unit, detail, isPrimary = false }) {
  return (
    <article className={`metric-card${isPrimary ? ' metric-card-primary' : ''}`}>
      <h2 className="metric-label">{label}</h2>
      <p className="metric-value">
        {value}
        {unit && <span>{unit}</span>}
      </p>
      <p className="metric-detail">{detail}</p>
    </article>
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

function AssistantIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
      <path d="M7 8h6M7 10.5h4" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  )
}

function SubmitIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 10h12M10 4.5l5.5 5.5-5.5 5.5" />
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
  const [shortfalls, setShortfalls] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [metadata, setMetadata] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantMessages, setAssistantMessages] = useState([])
  const [assistantLoading, setAssistantLoading] = useState(false)
  const assistantTriggerRef = useRef(null)
  const assistantInputRef = useRef(null)

  const fetchAnalysis = useCallback(async () => {
    const response = await axios.get(API_URL, {
      params: REQUEST_PARAMS,
    })
    return validateAnalysisPayload(response.data)
  }, [])

  const applyAnalysis = useCallback((data) => {
    setChartData(data.chart_data)
    setShortfalls(data.shortfalls)
    setMetrics(data.metrics)
    setMetadata(data.metadata)
    setError(null)
    setLastUpdated(new Date())
  }, [])

  const loadAnalysis = useCallback(async () => {
    try {
      applyAnalysis(await fetchAnalysis())
    } catch (requestError) {
      setError(getAnalysisErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [applyAnalysis, fetchAnalysis])

  useEffect(() => {
    let active = true
    fetchAnalysis()
      .then((data) => {
        if (active) applyAnalysis(data)
      })
      .catch((requestError) => {
        if (active) setError(getAnalysisErrorMessage(requestError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [applyAnalysis, fetchAnalysis])

  useEffect(() => {
    if (!assistantOpen) return undefined

    assistantInputRef.current?.focus()
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setAssistantOpen(false)
        assistantTriggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [assistantOpen])

  useEffect(() => {
    const log = document.querySelector('.assistant-log')
    if (log) log.scrollTop = log.scrollHeight
  }, [assistantMessages, assistantLoading, assistantOpen])

  const refreshAnalysis = () => {
    setLoading(true)
    loadAnalysis()
  }

  const submitAssistantQuestion = async (event) => {
    event.preventDefault()
    const question = assistantQuestion.trim()
    if (!question || !metrics || assistantLoading) return

    const messageId = `${Date.now()}-${assistantMessages.length}`
    setAssistantMessages((messages) => [
      ...messages,
      { id: messageId, question, answer: null, error: null },
    ])
    setAssistantQuestion('')
    setAssistantLoading(true)

    try {
      const response = await axios.post(ASSISTANT_API_URL, {
        question,
        context: {
          metrics,
          shortfalls,
          chart_data_summary: summarizeChartData(chartData),
        },
      })
      if (typeof response.data?.answer !== 'string' || !response.data.answer.trim()) {
        throw new Error('The assistant returned an empty response.')
      }
      setAssistantMessages((messages) =>
        messages.map((message) =>
          message.id === messageId
            ? { ...message, answer: response.data.answer.trim() }
            : message,
        ),
      )
    } catch (requestError) {
      const message =
        requestError.response?.data?.response ||
        requestError.response?.data?.detail ||
        requestError.message ||
        'Assistant request failed. Try again.'
      setAssistantMessages((messages) =>
        messages.map((item) =>
          item.id === messageId ? { ...item, error: message } : item,
        ),
      )
    } finally {
      setAssistantLoading(false)
    }
  }

  const matched = metrics?.matched_coverage?.matched
  const expected = metrics?.matched_coverage?.expected
  const coverage = `${formatNumber(matched)} / ${formatNumber(expected)}`
  const coveragePercent =
    Number.isFinite(matched) && Number.isFinite(expected) && expected > 0
      ? Math.round((matched / expected) * 100)
      : null

  return (
    <main className="app-shell">
      <div className="dashboard">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              N
            </span>
            <span className="brand-wordmark">
              <strong>northstar</strong>
              <small>ENERGY TRADING</small>
            </span>
          </div>
          <div className="topbar-right">
            <span className="source-indicator">
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
            <button
              ref={assistantTriggerRef}
              className="refresh-button assistant-trigger"
              onClick={() => setAssistantOpen(true)}
              aria-controls="assistant-panel"
              aria-expanded={assistantOpen}
              type="button"
            >
              <span className="assistant-icon">
                <AssistantIcon />
              </span>
              Ask Assistant
            </button>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <h1>Wind forecast accuracy</h1>
            <p className="page-subtitle">
              A decision-time view of Elexon’s national wind forecast against
              realised generation.
            </p>
          </div>
          <div className="period-panel">
            <span className="period-label">Delivery window</span>
            <time dateTime="2026-01">01-31 Jan 2026</time>
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
                detail={`Across ${formatNumber(matched)} matched periods`}
                isPrimary
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
                detail="Positive values indicate over-forecast"
              />
              <MetricReadout
                label="Matched coverage"
                value={coverage}
                detail={`${coveragePercent ?? '—'}% of ${formatNumber(expected)} expected periods`}
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

                <div className="chart-legend" aria-label="Chart series">
                  <span>
                    <i className="legend-line legend-actual" aria-hidden="true" />
                    Actual
                  </span>
                  <span>
                    <i className="legend-line legend-forecast" aria-hidden="true" />
                    Day-ahead forecast
                  </span>
                </div>

                {chartData.length === 0 ? (
                  <div className="empty-chart">No matched periods to chart.</div>
                ) : (
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={chartData}
                        margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
                      >
                        <XAxis
                          dataKey="startTime"
                          minTickGap={32}
                          tickFormatter={(value) =>
                            formatUKTime(value, { day: '2-digit', month: 'short' })
                          }
                          tick={{ fill: '#64748b', fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          width={48}
                          tickFormatter={formatNumber}
                          tick={{ fill: '#64748b', fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip content={<ForecastTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="actual_generation"
                          name="Actual"
                          stroke="#0f766e"
                          strokeWidth={2.25}
                          isAnimationActive={false}
                          dot={false}
                          activeDot={{ r: 4, fill: '#0f766e', stroke: '#ffffff', strokeWidth: 2 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast_generation"
                          name="Day-ahead forecast"
                          stroke="#b45309"
                          strokeWidth={2}
                          strokeDasharray="4 5"
                          isAnimationActive={false}
                          dot={false}
                          activeDot={{ r: 4, fill: '#b45309', stroke: '#ffffff', strokeWidth: 2 }}
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
                      Largest outturn-above-forecast gaps · MW
                    </p>
                  </div>
                  <span className="risk-tag">SHORTFALLS</span>
                </div>

                {shortfalls.length === 0 ? (
                  <div className="empty-watchlist">
                    No forecast shortfalls in the matched periods.
                  </div>
                ) : (
                  <div className="watchlist-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">DELIVERY (UK)</th>
                          <th scope="col">OUTTURN</th>
                          <th scope="col">FORECAST</th>
                          <th scope="col">GAP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shortfalls.map((row) => (
                          <tr key={row.delivery_time}>
                            <td>
                              <strong>
                                {formatUKTime(row.delivery_time, {
                                  day: '2-digit',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </strong>
                              <small>
                                Issued{' '}
                                {formatUKTime(row.forecast_publish_time, {
                                  day: '2-digit',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </small>
                            </td>
                            <td>{formatNumber(row.outturn)}</td>
                            <td>{formatNumber(row.forecast)}</td>
                            <td className="shortfall">+{formatNumber(row.gap)}</td>
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
      {assistantOpen && (
        <aside
          id="assistant-panel"
          className="assistant-panel"
          aria-label="Dashboard assistant"
        >
          <header className="assistant-header">
            <div>
              <h2>Dashboard assistant</h2>
              <p>Current dashboard data · January 2026</p>
            </div>
            <button
              className="assistant-close"
              onClick={() => {
                setAssistantOpen(false)
                assistantTriggerRef.current?.focus()
              }}
              type="button"
              aria-label="Close assistant"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="assistant-log" role="log" aria-live="polite">
            {assistantMessages.length === 0 ? (
              <p className="assistant-empty">
                Ask about the metrics, matched periods, or listed shortfalls.
                Answers are limited to the data currently shown on the
                dashboard.
              </p>
            ) : (
              assistantMessages.map((message) => (
                <article className="assistant-entry" key={message.id}>
                  <div className="assistant-query">
                    <span aria-hidden="true">&gt;</span>
                    <p>{message.question}</p>
                  </div>
                  {message.answer && (
                    <p className="assistant-answer">{message.answer}</p>
                  )}
                  {message.error && (
                    <p className="assistant-error" role="alert">
                      Request failed: {message.error}
                    </p>
                  )}
                </article>
              ))
            )}
            {assistantLoading && (
              <p className="assistant-loading" role="status">
                <span aria-hidden="true" />
                Querying data model...
              </p>
            )}
          </div>

          <form className="assistant-form" onSubmit={submitAssistantQuestion}>
            <label className="assistant-input-label" htmlFor="assistant-question">
              Ask about this dashboard
            </label>
            <div className="assistant-input-row">
              <input
                ref={assistantInputRef}
                id="assistant-question"
                type="text"
                value={assistantQuestion}
                onChange={(event) => setAssistantQuestion(event.target.value)}
                placeholder={
                  metrics ? 'Enter a data question...' : 'Waiting for dashboard data...'
                }
                maxLength={2000}
                disabled={!metrics || assistantLoading}
              />
              <button
                type="submit"
                className="assistant-submit"
                aria-label="Send question"
                disabled={!metrics || assistantLoading || !assistantQuestion.trim()}
              >
                <SubmitIcon />
              </button>
            </div>
            <p className="assistant-disclaimer">
              Responses use only the metrics and chart data shown here.
            </p>
          </form>
        </aside>
      )}
    </main>
  )
}

export default App
