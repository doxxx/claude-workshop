// When the last main-thread response that touched the prompt cache arrived,
// in $.clock.now() milliseconds.
export type CachedAt = number | null

// The directory and git branch shown in the rule above the band.
export type Location = { path: string; worktree: string | null; branch: string | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { cachedAt: CachedAt; effort: string | null; location: Location | null }
  }
}
