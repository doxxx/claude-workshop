import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, ThemeKey } from 'claude-code'
import type { Location } from '../types'

const cachedAt = atom({ plugin: 'usage-band', key: 'cachedAt' } as const, null)
const effort = atom({ plugin: 'usage-band', key: 'effort' } as const, null)
const location = atom({ plugin: 'usage-band', key: 'location' } as const, null)

// The mod API reports no cache TTL. Main-thread requests on this account
// write 1h cache entries, so the expiry is counted from that.
const CACHE_TTL_MS = 60 * 60 * 1000
// The narrowest a bar's track gets; past that it grows with the band.
const MIN_BAR_CELLS = 8
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Theme keys rather than raw colors, so the band follows the person's theme
// on every surface. Each names the part's role, not a hue.
const COLORS = {
  rule: 'subtle',
  // A border color: dark enough behind a fill on the desktop, where the text
  // keys such as subtle draw as a light muted grey.
  track: 'promptBorder',
  path: 'ide',
  worktree: 'success',
  branch: 'warning',
  model: 'text',
  // Segment labels and figures read as plain text; the fills carry the color.
  label: 'text',
  context: 'suggestion',
  limit: 'permission',
} as const satisfies Record<string, ThemeKey>

// Renders a token count compactly: 850, 45k, 1.2M. Rounding to thousands
// first keeps 999,500 from rendering as "1000k".
export const formatTokens = (tokens: number): string => {
  const thousands = Math.round(tokens / 1000)
  if (thousands >= 1000) return `${(thousands / 1000).toFixed(1)}M`
  if (tokens >= 1000) return `${thousands}k`
  return `${Math.round(tokens)}`
}

// The share of a bar's track its fill covers, as a CSS-style width. Clamped,
// since a window can report past 100%.
export const fillWidth = (percent: number): string =>
  `${Math.round(Math.min(100, Math.max(0, percent)))}%`

// Formats an epoch time in the local zone, which the hooks environment does
// not know: offsetMinutes comes from the host's `date +%z`. The day name is
// added for the weekly window, whose reset can be days out.
export const formatTime = (
  epochMs: number,
  offsetMinutes: number,
  withDay: boolean,
): string => {
  const local = new Date(epochMs + offsetMinutes * 60_000)
  const hours = local.getUTCHours()
  const minutes = String(local.getUTCMinutes()).padStart(2, '0')
  const time = `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
  return withDay ? `${DAYS[local.getUTCDay()]} ${time}` : time
}

// Parses `date +%z` output such as "-0400" into minutes east of UTC.
export const parseOffset = (text: string): number | null => {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

// Replaces a leading home folder with ~, as a whole path component only, so
// /home/gordon-old does not become ~-old. Each pair is a path and the home it
// is tested against, and the first that matches wins. Callers pass resolved
// pairs too, since /home can be a symlink to /var/home.
export const tildify = (path: string, pairs: readonly [string, string][]): string => {
  for (const [candidate, home] of pairs) {
    if (!candidate || !home) continue
    if (candidate === home) return '~'
    if (candidate.startsWith(`${home}/`)) return `~${candidate.slice(home.length)}`
  }
  return path
}

// Inside a linked worktree, the path as it would read in the main working
// tree, keeping any subdirectory below the worktree root. Rebasing onto the
// main root also covers worktrees placed outside .claude/worktrees.
export const mainTreePath = (cwd: string, worktreeRoot: string, commonDir: string): string => {
  if (!commonDir.endsWith('/.git')) return cwd
  if (cwd !== worktreeRoot && !cwd.startsWith(`${worktreeRoot}/`)) return cwd
  return commonDir.slice(0, -'/.git'.length) + cwd.slice(worktreeRoot.length)
}

// Reads `git status --porcelain=v2 --branch` output: "# branch.ab +A -B" holds
// the commits ahead of and behind the upstream, and appears only when there
// is one; every line not starting with # is a changed file.
export const parseStatus = (text: string): Pick<Location, 'ahead' | 'behind' | 'modified'> => {
  let ahead = 0
  let behind = 0
  let modified = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    const ab = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
    if (ab) {
      ahead = Number(ab[1])
      behind = Number(ab[2])
    } else if (!line.startsWith('#')) {
      modified++
    }
  }
  return { ahead, behind, modified }
}

// The text inside the branch's parentheses: incoming ↓ and outgoing ↑ commits
// and the * count of modified files, each only when nonzero, then the branch.
export const branchText = (location: Location): string =>
  [
    location.behind ? `↓${location.behind}` : '',
    location.ahead ? `↑${location.ahead}` : '',
    location.modified ? `*${location.modified}` : '',
    location.branch ?? '',
  ]
    .filter(Boolean)
    .join(' ')

// The label's width as drawn: the path, then " {wt name}" and " (branch)".
export const labelLength = (location: Location): number =>
  location.path.length +
  (location.worktree ? ` {wt ${location.worktree}}`.length : 0) +
  (location.branch ? ` (${branchText(location)})`.length : 0)

// The number of ─ cells between the rule's two labels: "── " and a space
// around the left one (the folder, absent outside a repo's location), a space
// and " ──" around the right one (the model). At least one, so it still
// reads as a border.
export const ruleFill = (
  columns: number,
  leftLength: number | null,
  rightLength: number,
): number => {
  const left = leftLength === null ? 0 : 3 + leftLength + 1
  const right = 1 + rightLength + 3
  return Math.max(1, columns - left - right)
}

// Runs git in a directory, resolving to its trimmed output, or '' when it
// fails, which includes running outside a repo.
const git = async ($: EngineInterface, cwd: string, args: string[]): Promise<string> => {
  try {
    const result = await $.process.run(['git', '--no-optional-locks', ...args], { cwd })
    return result.exitCode === 0 ? result.stdout.trim() : ''
  } catch {
    return ''
  }
}

const findLocation = async ($: EngineInterface): Promise<Location> => {
  const cwd = await $.session.cwd()
  const [dirs, current, status] = await Promise.all([
    git($, cwd, [
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
      '--git-common-dir',
      '--show-toplevel',
    ]),
    git($, cwd, ['branch', '--show-current']),
    // Untracked files are left out, so the count is of modified files only.
    // The incoming count is as of the last fetch; nothing here fetches.
    git($, cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=no']),
  ])

  // An empty branch is either a detached HEAD or no repo at all; HEAD still
  // resolving to a commit tells them apart.
  let branch: string | null = current || null
  if (!branch && dirs) {
    const sha = await git($, cwd, ['rev-parse', '--short', 'HEAD'])
    if (sha) branch = `detached@${sha}`
  }

  // A linked worktree's git dir is <common dir>/worktrees/<name>.
  let path = cwd
  let worktree: string | null = null
  const [gitDir, commonDir, toplevel] = dirs.split('\n')
  if (gitDir && commonDir && toplevel && gitDir !== commonDir) {
    worktree = gitDir.slice(gitDir.lastIndexOf('/') + 1)
    path = mainTreePath(cwd, toplevel, commonDir)
  }

  const home = (await $.env.get('HOME')) ?? ''
  let resolved: string[] = []
  if (home) {
    try {
      const result = await $.process.run(['readlink', '-f', '--', home, path])
      resolved = result.stdout.split('\n')
    } catch {}
  }
  const [homeReal = '', pathReal = ''] = resolved
  // The unresolved pair goes first, so a path that only passes through some
  // other symlink below home keeps the spelling it was given.
  path = tildify(path, [
    [path, home],
    [path, homeReal],
    [pathReal, homeReal],
  ])

  return { path, worktree, branch, ...parseStatus(status) }
}

// Stores the location, which redraws the band when it changed.
async function refreshLocation($: EngineInterface): Promise<void> {
  const found = await findLocation($)
  await update($, location, () => found)
}

export const register: Register = on => {
  let offsetMinutes = -new Date().getTimezoneOffset()

  on('session.start', async ($, e, next) => {
    const result = await $.process.run(['date', '+%z'])
    offsetMinutes = parseOffset(result.stdout) ?? offsetMinutes

    if ((await read($, effort)) === null) {
      const { effortLevel } = (await $.settings.read()) as { effortLevel?: string }
      if (effortLevel) await update($, effort, () => effortLevel)
    }

    // Reset times and the cache expiry move with the clock, not with any
    // event, so the band redraws on a timer as well. The directory and branch
    // can change outside a turn, so they refresh there too.
    $.clock.every(30_000, () => refreshLocation($))
    await refreshLocation($)

    return next(e)
  })

  // A turn's commands can change branch or directory, so the location is read
  // again after each main-thread turn rather than on every render.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refreshLocation($)
    return result
  })

  // turn.step streams, so the hook forwards the response's chunks unchanged
  // and reads the usage off the result at the end.
  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    if (isMain && e.effort !== undefined) {
      const level = String(e.effort)
      await update($, effort, () => level)
    }

    const result = yield* next(e)
    const usage = result.usage
    const touchedCache =
      usage !== null &&
      usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0
    if (isMain && touchedCache) {
      const at = await $.clock.now()
      await update($, cachedAt, () => at)
    }

    return result
  })

  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const [model, level, place, usage, lastCachedAt, now] = await Promise.all([
      $.session.model(),
      read($, effort),
      read($, location),
      $.session.usage(),
      read($, cachedAt),
      $.clock.now(),
    ])

    const resetText = (limit: SessionRateLimit, withDay: boolean) => {
      if (!limit.resetsAt) return ''
      const at = Date.parse(limit.resetsAt)
      // A reset already gone by stays reported until the next response.
      return at > now ? ` (${formatTime(at, offsetMinutes, withDay)})` : ''
    }

    // A segment draws as its label, a bar filled to percent, then its text.
    const segments: { label: string; color: ThemeKey; percent: number; text: string }[] = []

    const { percent, tokens } = usage.context
    if (percent !== undefined) {
      const count = tokens !== undefined ? ` ${formatTokens(tokens)}` : ''
      // The prompt cache's expiry rides along with the context it holds; a
      // lapsed cache reads "cold" until the next response writes it again.
      let expiry = ''
      if (lastCachedAt !== null) {
        const expiresAt = lastCachedAt + CACHE_TTL_MS
        expiry =
          expiresAt > now ? ` (${formatTime(expiresAt, offsetMinutes, false)})` : ' (cold)'
      }
      segments.push({
        label: 'Context',
        color: COLORS.context,
        percent,
        text: `${Math.round(percent)}%${count}${expiry}`,
      })
    }

    for (const [label, kind, withDay] of [
      ['Session', 'five_hour', false],
      ['Weekly', 'seven_day', true],
    ] as const) {
      const limit = usage.rateLimits.find(one => one.kind === kind)
      if (!limit) continue
      segments.push({
        label,
        color: COLORS.limit,
        percent: limit.percentUsed,
        text: `${Math.round(limit.percentUsed)}%${resetText(limit, withDay)}`,
      })
    }

    // The desktop app shows the folder, branch, model and effort around its
    // own prompt, so there the band keeps only the usage bars.
    const isDesktop = e.surface === 'desktop'
    if (isDesktop && segments.length === 0) return next(e)

    // The rule carries the folder and branch on the left and the model and
    // effort on the right, the ─ fill between them.
    const modelText = `${model}${level ? ` [${level}]` : ''}`
    const fill = ruleFill(e.props.bodyColumns, place ? labelLength(place) : null, modelText.length)
    const rule = (
      <Text wrap="truncate">
        {place ? (
          <Text>
            <Text color={COLORS.rule}>── </Text>
            <Text color={COLORS.path} bold>
              {place.path}
            </Text>
            {place.worktree ? <Text color={COLORS.worktree}>{` {wt ${place.worktree}}`}</Text> : null}
            {place.branch ? <Text color={COLORS.branch}>{` (${branchText(place)})`}</Text> : null}
            <Text color={COLORS.rule}> </Text>
          </Text>
        ) : null}
        <Text color={COLORS.rule}>{`${'─'.repeat(fill)} `}</Text>
        <Text color={COLORS.model}>{modelText}</Text>
        <Text color={COLORS.rule}> ──</Text>
      </Text>
    )

    return (
      <Box flexDirection="column">
        {isDesktop ? null : rule}
        <Box width="100%">
          {segments.map((segment, index) => (
            // Each segment starts from no width and grows by the same share,
            // so the segments split the band evenly and fill it.
            <Box key={segment.label} flexGrow={1} width={0}>
              {index === 0 ? null : <Text color={COLORS.rule}> │ </Text>}
              <Text color={COLORS.label}>{`${segment.label} `}</Text>
              {/* The track takes the segment's room left over from its text;
                  the fill inside it is sized by percentage, so it is exact
                  where the surface draws in pixels and rounds to cells in a
                  terminal. */}
              <Box flexGrow={1} minWidth={MIN_BAR_CELLS} height={1} backgroundColor={COLORS.track}>
                <Box width={fillWidth(segment.percent)} height={1} backgroundColor={segment.color} />
              </Box>
              <Text color={COLORS.label} wrap="truncate">{` ${segment.text}`}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
