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
const ASSISTANT_SUGGESTIONS = [
  { icon: 'accuracy', question: 'Summarize January forecast accuracy.' },
  { icon: 'bias', question: 'Explain the forecast bias.' },
  { icon: 'shortfall', question: 'Which delivery periods had the largest shortfalls?' },
  { icon: 'compare', question: 'Compare forecast and actual generation.' },
  { icon: 'coverage', question: 'How reliable is the matched-period coverage?' },
]

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

function NorthStarIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 1.5 12 8l6.5 2L12 12l-2 6.5L8 12l-6.5-2L8 8l2-6.5Z" />
    </svg>
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

function AssistantSparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 13.7 9l6.1 1.8-6.1 1.7L12 18.7l-1.7-6.2-6.1-1.7L10.3 9 12 2.8Z" />
      <path d="m19 15 .8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8L19 15Z" />
    </svg>
  )
}

function AssistantSuggestionIcon({ kind }) {
  const paths = {
    accuracy: <path d="M3 15.5 8 10l3.5 3.5L18 6m-4 0h4v4" />,
    bias: <path d="M4 16h5V8h5V4h6M16 4h4v4" />,
    shortfall: <path d="M4 5h4v14H4zm6 6h4v8h-4zm6-5h4v13h-4z" />,
    compare: <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />,
    coverage: <path d="M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z" />,
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[kind]}
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 10h12M10 4.5l5.5 5.5-5.5 5.5" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 21 20H3l9-16.5Z" />
      <path d="M12 9v5m0 3h.01" />
    </svg>
  )
}

function LoadingIcon() {
  return <span className="assistant-send-spinner" aria-hidden="true" />
}

function renderInlineAssistantText(text, keyPrefix) {
  const tokenPattern =
    /(\*\*[^*]+\*\*|`[^`]+`|(?<![\w])[-+]?\d[\d,]*(?:\.\d+)?\s?(?:MW|%)(?![\w]))/g
  const parts = []
  let cursor = 0

  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index))
    }

    const token = match[0]
    if (token.startsWith('**')) {
      parts.push(<strong key={`${keyPrefix}-${match.index}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      parts.push(<code key={`${keyPrefix}-${match.index}`}>{token.slice(1, -1)}</code>)
    } else {
      parts.push(
        <span className="assistant-inline-metric" key={`${keyPrefix}-${match.index}`}>
          {token}
        </span>,
      )
    }
    cursor = match.index + token.length
  }

  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function AssistantAnswer({ text }) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    if (/^#{1,3}\s/.test(line)) {
      blocks.push({ type: 'heading', text: line.replace(/^#{1,3}\s+/, '') })
      index += 1
      continue
    }

    if (line.startsWith('|') && /^\|?[\s:|-]+\|?$/.test(lines[index + 1]?.trim() ?? '')) {
      const headers = line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim())
      index += 2
      const rows = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(
          lines[index]
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((cell) => cell.trim()),
        )
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    const listMatch = line.match(/^([-*]|\d+[.)])\s+(.+)/)
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1])
      const items = []
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(/^([-*]|\d+[.)])\s+(.+)/)
        if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break
        items.push(itemMatch[2])
        index += 1
      }
      blocks.push({ type: ordered ? 'ordered-list' : 'list', items })
      continue
    }

    const paragraph = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^#{1,3}\s/.test(lines[index].trim()) &&
      !/^([-*]|\d+[.)])\s+/.test(lines[index].trim()) &&
      !(lines[index].trim().startsWith('|') &&
        /^\|?[\s:|-]+\|?$/.test(lines[index + 1]?.trim() ?? ''))
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
  }

  if (!blocks.length) {
    return <p className="assistant-no-answer">No answer text was returned.</p>
  }

  return (
    <div className="assistant-answer">
      {blocks.map((block, blockIndex) => {
        const key = `answer-${blockIndex}`
        if (block.type === 'heading') {
          return (
            <h3 className="assistant-answer-heading" key={key}>
              {renderInlineAssistantText(block.text, key)}
            </h3>
          )
        }
        if (block.type === 'list' || block.type === 'ordered-list') {
          const List = block.type === 'list' ? 'ul' : 'ol'
          return (
            <List className="assistant-answer-list" key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  {renderInlineAssistantText(item, `${key}-${itemIndex}`)}
                </li>
              ))}
            </List>
          )
        }
        if (block.type === 'table') {
          return (
            <div className="assistant-answer-table-wrap" key={key}>
              <table className="assistant-answer-table">
                <thead>
                  <tr>
                    {block.headers.map((cell, cellIndex) => (
                      <th key={`${key}-head-${cellIndex}`}>
                        {renderInlineAssistantText(cell, `${key}-head-${cellIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${rowIndex}`}>
                      {block.headers.map((_, cellIndex) => (
                        <td key={`${key}-${rowIndex}-${cellIndex}`}>
                          {renderInlineAssistantText(
                            row[cellIndex] ?? '',
                            `${key}-${rowIndex}-${cellIndex}`,
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return (
          <p className="assistant-answer-paragraph" key={key}>
            {renderInlineAssistantText(block.text, key)}
          </p>
        )
      })}
    </div>
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
  const [isCompactScreen, setIsCompactScreen] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 720px)').matches,
  )
  const [assistantQuestion, setAssistantQuestion] = useState('')
  const [assistantMessages, setAssistantMessages] = useState([])
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantRequestId, setAssistantRequestId] = useState(null)
  const assistantTriggerRef = useRef(null)
  const assistantInputRef = useRef(null)
  const assistantMessageSequenceRef = useRef(0)

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
    const mediaQuery = window.matchMedia('(max-width: 720px)')
    const updateCompactScreen = () => setIsCompactScreen(mediaQuery.matches)
    mediaQuery.addEventListener('change', updateCompactScreen)
    return () => mediaQuery.removeEventListener('change', updateCompactScreen)
  }, [])

  useEffect(() => {
    const log = document.querySelector('.assistant-log')
    if (log) log.scrollTop = log.scrollHeight
  }, [assistantMessages, assistantLoading, assistantOpen])

  const refreshAnalysis = () => {
    setLoading(true)
    loadAnalysis()
  }

  const askAssistant = async (question, existingMessageId = null) => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || !metrics || assistantLoading) return

    let messageId = existingMessageId
    if (messageId) {
      setAssistantMessages((messages) =>
        messages.map((message) =>
          message.id === messageId
            ? { ...message, answer: null, error: null }
            : message,
        ),
      )
    } else {
      assistantMessageSequenceRef.current += 1
      messageId = `assistant-${assistantMessageSequenceRef.current}`
      setAssistantMessages((messages) => [
        ...messages,
        { id: messageId, question: trimmedQuestion, answer: null, error: null },
      ])
    }
    setAssistantQuestion('')
    setAssistantLoading(true)
    setAssistantRequestId(messageId)

    try {
      const response = await axios.post(ASSISTANT_API_URL, {
        question: trimmedQuestion,
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
      setAssistantRequestId(null)
    }
  }

  const submitAssistantQuestion = (event) => {
    event.preventDefault()
    askAssistant(assistantQuestion)
  }

  const handleAssistantInputKeyDown = (event) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      if (assistantQuestion.trim()) askAssistant(assistantQuestion)
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
    <main className="app-shell flex h-screen overflow-hidden bg-slate-50 font-sans">
      <div
        className={`dashboard flex-1 overflow-y-auto p-8${assistantOpen ? ' assistant-is-open' : ''}`}
      >
        <header className="topbar">
          <div className="brand">
            <span className="brand-star" aria-hidden="true">
              <NorthStarIcon />
            </span>
            <span className="brand-name">northstar</span>
            <span className="brand-context">Day-ahead wind desk</span>
          </div>
          <div className="topbar-right">
            <span className="topbar-source">Elexon BMRS</span>
            <button
              className="icon-button"
              onClick={refreshAnalysis}
              disabled={loading}
              type="button"
              aria-label="Refresh data"
              title="Refresh data"
            >
              <span className={loading ? 'refresh-icon is-loading' : 'refresh-icon'}>
                <RefreshIcon />
              </span>
            </button>
            <button
              ref={assistantTriggerRef}
              className="assistant-button"
              onClick={() => setAssistantOpen((open) => !open)}
              aria-controls="assistant-panel"
              aria-expanded={assistantOpen}
              type="button"
            >
              <span className="assistant-icon">
                <AssistantIcon />
              </span>
              Assistant
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
            <time dateTime="2026-01">1–31 January 2026</time>
            <span className="period-meta">Delivery window · Great Britain · UK time</span>
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

                {assistantOpen && isCompactScreen ? null : chartData.length === 0 ? (
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
                          tick={{ fill: '#64748b', fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          width={56}
                          tickFormatter={formatNumber}
                          tick={{ fill: '#64748b', fontSize: 12 }}
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
                  <b>11:00 UK D-1 cutoff</b>. Forecasts are hourly; each hourly
                  forecast covers both half-hourly FUELHH settlement periods in
                  that delivery hour—no interpolation. MAPE omits zero-actual
                  periods.
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
      <aside
        id="assistant-panel"
        className={`assistant-sidebar${assistantOpen ? ' is-open' : ''}`}
        aria-label="Dashboard assistant"
        aria-hidden={!assistantOpen}
        aria-labelledby="assistant-title"
        inert={!assistantOpen}
      >
        <div className="assistant-header">
          <div className="assistant-header-content">
            <span className="assistant-header-mark" aria-hidden="true">
              <AssistantSparkleIcon />
            </span>
            <h2 id="assistant-title">Northstar Assistant</h2>
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
        </div>

        <div className="assistant-log" role="log" aria-live="polite">
          {assistantMessages.length === 0 ? (
            metrics ? (
              <div className="assistant-welcome">
                <span className="assistant-welcome-mark" aria-hidden="true">
                  <AssistantSparkleIcon />
                </span>
                <h3>Ask about the January forecast</h3>
                <p>
                  Answers are grounded in the dashboard&apos;s January 2026 data.
                </p>
                <div className="assistant-suggestions">
                  {ASSISTANT_SUGGESTIONS.map(({ icon, question }) => (
                    <button
                      className="assistant-suggestion"
                      key={question}
                      type="button"
                      disabled={assistantLoading}
                      onClick={() => askAssistant(question)}
                    >
                      <span className="assistant-suggestion-icon" aria-hidden="true">
                        <AssistantSuggestionIcon kind={icon} />
                      </span>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="assistant-data-empty" role="status">
                <span className="assistant-data-empty-mark" aria-hidden="true">
                  <WarningIcon />
                </span>
                <h3>Dashboard data unavailable</h3>
                <p>
                  {loading
                    ? 'Waiting for the January wind analysis to load.'
                    : error || 'Refresh the dashboard to load current metrics.'}
                </p>
              </div>
            )
          ) : (
            assistantMessages.map((message, messageIndex) => (
              <article className="assistant-entry" key={message.id}>
                <div className="assistant-query">{message.question}</div>
                {(message.answer || assistantRequestId === message.id) && (
                  <div className="assistant-response">
                    <span className="assistant-response-mark" aria-hidden="true">
                      <AssistantSparkleIcon />
                    </span>
                    <div className="assistant-response-body">
                      {message.answer && (
                        <AssistantAnswer text={message.answer} />
                      )}
                      {assistantRequestId === message.id && !message.answer && (
                        <div className="assistant-loading" role="status">
                          <LoadingIcon />
                          Thinking…
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {message.error && (
                  <div className="assistant-error" role="alert">
                    <p>{message.error}</p>
                    <button
                      className="assistant-retry"
                      type="button"
                      onClick={() => askAssistant(message.question, message.id)}
                      disabled={assistantLoading}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {message.answer &&
                  !message.error &&
                  messageIndex === assistantMessages.length - 1 &&
                  !assistantLoading && (
                    <div
                      className="assistant-followups"
                      aria-label="Suggested follow-up questions"
                    >
                      {[
                        'How do MAE and MAPE differ here?',
                        'What do the largest shortfalls show?',
                      ].map((followup) => (
                        <button
                          key={followup}
                          type="button"
                          onClick={() => askAssistant(followup)}
                          disabled={assistantLoading}
                        >
                          {followup}
                        </button>
                      ))}
                    </div>
                  )}
              </article>
            ))
          )}
        </div>

        <div className="assistant-input-area">
          <form onSubmit={submitAssistantQuestion}>
            <div className="assistant-composer">
              <textarea
                ref={assistantInputRef}
                id="assistant-question"
                rows={2}
                className="assistant-query-input"
                value={assistantQuestion}
                onChange={(event) => setAssistantQuestion(event.target.value)}
                onKeyDown={handleAssistantInputKeyDown}
                placeholder="Ask about the forecast…"
                maxLength={2000}
                disabled={!metrics || assistantLoading}
                aria-label="Ask about forecast accuracy"
              />
              <button
                className="assistant-send"
                type="submit"
                aria-label={assistantLoading ? 'Sending question' : 'Send question'}
                title="Send question"
                disabled={!metrics || assistantLoading || !assistantQuestion.trim()}
              >
                {assistantLoading ? <LoadingIcon /> : <SendIcon />}
              </button>
            </div>
          </form>
          <p className="assistant-disclaimer">
            Grounded in current dashboard data
          </p>
        </div>
      </aside>
    </main>
  )
}

export default App
