// When the last main-thread response that touched the prompt cache arrived,
// in $.clock.now() milliseconds.
export type CachedAt = number | null

// The directory and git branch shown in the rule above the band, with the
// commits ahead of and behind the upstream and the count of modified files.
export type Location = {
  path: string
  worktree: string | null
  branch: string | null
  ahead: number
  behind: number
  modified: number
}

// The rate-limit windows last reported on this machine, from the store, shown
// until the session's own first response reports live ones. Each window is as
// $.session.usage() reports it (SessionRateLimit).
export type SavedLimit = { kind: string; percentUsed: number; resetsAt?: string }
export type SavedLimits = SavedLimit[] | null

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      cachedAt: CachedAt
      effort: string | null
      location: Location | null
      savedLimits: SavedLimits
    }
  }
}
