export type Totals = {
  /** Uncached input tokens, summed over every model request. */
  input: number
  /** Input tokens served from the prompt cache. */
  cacheRead: number
  /** Input tokens written to the prompt cache. */
  cacheWrite: number
  /** Generated tokens. */
  output: number
  /** Model requests counted (main thread and subagents). */
  requests: number
  /** Of those, requests made by subagents. */
  subagentRequests: number
  /** Model that answered the last request. */
  model: string | null
  /** When the session these counts belong to began ($.session.usage().startedAt). */
  since: number | null
}

export type Context = {
  /** Tokens the last main-thread response was answered over. */
  tokens: number | null
  /** The model's context window, in tokens. */
  window: number | null
  /** tokens / window, 0 to 100. */
  percent: number | null
  /** Session cost in USD, when the host keeps a ledger. */
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'token-monitor': { totals: Totals; context: Context }
  }
}
