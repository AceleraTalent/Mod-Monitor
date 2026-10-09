import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage } from 'claude-code'

import type { Context, Totals } from '../types'

const COMMAND = 'tokens'

// Above this the band turns yellow; at or above ALERT it turns red with a mark.
const WARN = 70
const ALERT = 80

const EMPTY_TOTALS: Totals = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  requests: 0,
  subagentRequests: 0,
  model: null,
  since: null,
}

const EMPTY_CONTEXT: Context = { tokens: null, window: null, percent: null, usd: null }

// Kept in the session's state rather than module variables, so a hot reload
// of the mod does not reset the session's counts.
const totals = atom({ plugin: 'token-monitor', key: 'totals' } as const, EMPTY_TOTALS)
const context = atom({ plugin: 'token-monitor', key: 'context' } as const, EMPTY_CONTEXT)

export const formatTokens = (n: number): string => {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** All input the model read: uncached, cache-written and cache-read. */
export const totalInput = (t: Totals): number => t.input + t.cacheRead + t.cacheWrite

/** Context fill, from the reported percent or estimated from tokens / window. */
export const contextPercent = (c: Context): number | null => {
  if (c.percent !== null) return c.percent
  if (c.tokens !== null && c.window) return Math.round((c.tokens / c.window) * 100)
  return null
}

const BAR_WIDTH = 20

/** The context level's colour: green below WARN, yellow up to ALERT, red past it. */
export const levelColor = (pct: number | null): 'success' | 'warning' | 'error' | 'inactive' => {
  if (pct === null) return 'inactive'
  if (pct >= ALERT) return 'error'
  if (pct >= WARN) return 'warning'

  return 'success'
}

export const progressBar = (pct: number | null, width: number): string => {
  const filled = Math.min(width, Math.max(0, Math.round(((pct ?? 0) / 100) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** The one-line status under the prompt, always on screen. */
export const statusText = (t: Totals, c: Context): string => {
  const pct = contextPercent(c)
  const mark = pct !== null && pct >= ALERT ? '⚠ ' : '◆ '
  const cost = c.usd === null ? '' : ` · $${c.usd.toFixed(2)}`

  return `${mark}ctx ${pct === null ? '—' : `${pct}%`} ${progressBar(pct, 10)} · ▲ ${formatTokens(totalInput(t))} in · ▼ ${formatTokens(t.output)} out${cost}`
}

export const bandText = (t: Totals, c: Context): string => {
  const pct = contextPercent(c)
  const ctx = pct === null ? '—' : `~${pct}%`

  return `[Contexto: ${ctx} | Tokens: ${formatTokens(totalInput(t))} in / ${formatTokens(t.output)} out]`
}

export const breakdownText = (t: Totals, c: Context): string => {
  const pct = contextPercent(c)
  const lines = [
    'Token monitor — consumo de la sesión',
    '',
    `  Entrada total     ${formatTokens(totalInput(t)).padStart(9)}`,
    `    sin caché       ${formatTokens(t.input).padStart(9)}`,
    `    escrito caché   ${formatTokens(t.cacheWrite).padStart(9)}`,
    `    leído caché     ${formatTokens(t.cacheRead).padStart(9)}`,
    `  Salida            ${formatTokens(t.output).padStart(9)}`,
    '',
    `  Peticiones        ${String(t.requests).padStart(9)}  (${t.subagentRequests} de subagentes)`,
    `  Modelo            ${t.model ?? '—'}`,
    '',
    `  Contexto          ${
      pct === null
        ? '— (aún sin respuesta)'
        : `~${pct}%  (${formatTokens(c.tokens ?? 0)} / ${formatTokens(c.window ?? 0)})`
    }`,
  ]
  if (c.usd !== null) lines.push(`  Coste estimado    $${c.usd.toFixed(4)}`)
  if (pct !== null && pct >= ALERT) {
    lines.push('', '  ⚠ El contexto supera el 80%: considera /compact o /clear.')
  }

  return lines.join('\n')
}

const saveContext = ($: EngineInterface, ctx: SessionContextUsage, usd: number | undefined) =>
  update($, context, () => ({
    tokens: ctx.tokens ?? null,
    window: ctx.window || null,
    percent: ctx.percent ?? null,
    usd: usd ?? null,
  }))

const refreshStatus = async ($: EngineInterface) =>
  $.ui.status(statusText(await read($, totals), await read($, context)))

export const register: Register = on => {
  // Set by session.start, which runs again on every load of the module.
  let hasSurface = true

  on('session.start', async ($, e, next) => {
    hasSurface = e.surface !== null
    await $.command.register({
      name: COMMAND,
      description: 'Desglose local del consumo de tokens de la sesión',
    })
    const usage = await $.session.usage()
    await saveContext($, usage.context, usage.cost?.usd)
    // A reload keeps the counts; /clear starts the session over, and so do they.
    await update($, totals, t =>
      t.since === usage.startedAt ? t : { ...EMPTY_TOTALS, since: usage.startedAt },
    )
    await refreshStatus($)

    return next(e)
  })

  // Every model request, main thread or subagent: add what it cost.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const usage = response.usage
    if (usage) {
      await update($, totals, t => ({
        input: t.input + usage.input_tokens,
        cacheRead: t.cacheRead + usage.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + usage.cache_creation_input_tokens,
        output: t.output + usage.output_tokens,
        requests: t.requests + 1,
        subagentRequests: t.subagentRequests + (e.agentId ? 1 : 0),
        model: usage.model,
        since: t.since,
      }))
      await refreshStatus($)
    }

    return response
  })

  // The engine's own measure of the live window, pushed after each turn.
  on('session.measure', async ($, e, next) => {
    await saveContext($, e.context, e.cost?.usd)
    await refreshStatus($)

    return next(e)
  })

  // A session with no surface attached (a cloud session followed from the
  // Claude app) never draws the band or the status line: there the monitor
  // rides the transcript instead, as a notice the model never reads.
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (!e.agentId && !hasSurface) {
      const text = statusText(await read($, totals), await read($, context))
      await $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } })
    }

    return ran
  })

  // Answered here, without next: no model call is made.
  on('command.run', { command: COMMAND }, async $ => ({
    text: breakdownText(await read($, totals), await read($, context)),
  })).catch(() => ({ text: 'token-monitor: no se pudo leer el consumo de la sesión.' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const t = await read($, totals)
    const c = await read($, context)
    const pct = contextPercent(c)
    const tone = levelColor(pct)
    const isNarrow = (e.viewport?.columns ?? 120) < 90
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box borderStyle="round" borderColor={tone} paddingX={1} columnGap={2} flexWrap="wrap">
        <Text color="claude" bold>
          {e.props.isWorking ? '◆ TOKENS ●' : '◆ TOKENS'}
        </Text>
        <Box columnGap={1}>
          <Text bold>Contexto</Text>
          {!isNarrow && <Text color={tone}>{progressBar(pct, BAR_WIDTH)}</Text>}
          <Text color={tone} bold>
            {pct === null ? '—' : `${pct}%`}
          </Text>
          {pct !== null && pct >= ALERT && (
            <Text color="error" bold>
              ⚠ /compact
            </Text>
          )}
        </Box>
        <Text>
          <Text color="suggestion" bold>
            ▲ {formatTokens(totalInput(t))}
          </Text>
          <Text dimColor> in</Text>
        </Text>
        <Text>
          <Text color="merged" bold>
            ▼ {formatTokens(t.output)}
          </Text>
          <Text dimColor> out</Text>
        </Text>
        {c.usd !== null && (
          <Text color="success" bold>
            ${c.usd.toFixed(2)}
          </Text>
        )}
      </Box>
    )
  })
}
