// When the last main-thread response that touched the prompt cache arrived,
// in $.clock.now() milliseconds.
export type CachedAt = number | null

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { cachedAt: CachedAt; effort: string | null }
  }
}
