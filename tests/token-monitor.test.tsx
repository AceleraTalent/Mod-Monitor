import { expect, mock, test } from 'claude-code/testing'

import { bandText, breakdownText, formatTokens, progressBar, statusText } from '../hooks/register'

const usage = {
  input_tokens: 1200,
  output_tokens: 1800,
  cache_read_input_tokens: 10_000,
  cache_creation_input_tokens: 1200,
  model: 'claude-test',
}

const measure = (tokens: number, window: number) => ({
  context: { tokens, window, percent: Math.round((tokens / window) * 100) },
  rateLimits: [],
  changed: ['context' as const],
})

test('formats token counts', async () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(12_400)).toBe('12.4k')
  expect(formatTokens(2_500_000)).toBe('2.50M')
})

test('the band text has the requested shape', async () => {
  const totals = {
    input: 1200, cacheRead: 10_000, cacheWrite: 1200, output: 1800,
    requests: 1, subagentRequests: 0, model: null, since: null,
  }
  const context = { tokens: 90_000, window: 200_000, percent: 45, usd: null }
  expect(bandText(totals, context)).toBe('[Contexto: ~45% | Tokens: 12.4k in / 1.8k out]')
  expect(breakdownText(totals, context)).toContain('Salida')
  expect(statusText(totals, context)).toBe('◆ ctx 45% █████░░░░░ · ▲ 12.4k in · ▼ 1.8k out')
  expect(progressBar(85, 20)).toBe('█'.repeat(17) + '░'.repeat(3))
})

test('counts model requests and answers /tokens locally', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage }
  })
  for (const _ of [1, 2]) {
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1 })
    for await (const _chunk of stream) {
      // drain
    }
  }
  await $.session.measure(measure(170_000, 200_000))

  const out = await $.command.run({
    command: 'tokens',
    args: '',
    origin: { kind: 'composer' },
    presentation: { layout: 'main', columns: 80 },
  } as never)
  expect(out.text).toContain('24.8k')
  expect(out.text).toContain('3.6k')
  expect(out.text).toContain('~85%')
  expect(out.text).toContain('⚠')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band warns above 80% on ${surface}`, async ($, on) => {
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure(measure(170_000, 200_000))
    const band = await $.ui.mount({
      plugin: 'token-monitor',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false } as never,
    })
    const drawn = JSON.stringify(await band.drawn())
    expect(drawn).toContain('"borderColor":"error"')
    expect(drawn).toContain('85%')
    expect(drawn).toContain('⚠ /compact')
  })

  test(`the band is green below 70% on ${surface}`, async ($, on) => {
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure(measure(20_000, 200_000))
    const band = await $.ui.mount({
      plugin: 'token-monitor',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false } as never,
    })
    const drawn = JSON.stringify(await band.drawn())
    expect(drawn).toContain('"borderColor":"success"')
    expect(drawn).toContain('10%')
    expect(drawn).not.toContain('⚠')
  })
}

test('with no surface attached, each main turn leaves the monitor in the transcript', async ($, on) => {
  const session = mock.session(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 200_000 }, rateLimits: [] } }))
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.session.measure(measure(30_000, 200_000))
  await $.turn.complete({
    turnId: 't', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false,
  } as never)
  const rows = JSON.stringify(session.appended())
  expect(rows).toContain('◆ ctx 15%')
})
