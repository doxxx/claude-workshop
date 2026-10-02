import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

const cachedAt = atom({ plugin: 'usage-band', key: 'cachedAt' } as const, null)
const effort = atom({ plugin: 'usage-band', key: 'effort' } as const, null)

// The mod API reports no cache TTL. Main-thread requests on this account
// write 1h cache entries, so the expiry is counted from that.
const CACHE_TTL_MS = 60 * 60 * 1000
const BAR_CELLS = 8
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Renders a token count compactly: 850, 45k, 1.2M. Rounding to thousands
// first keeps 999,500 from rendering as "1000k".
export const formatTokens = (tokens: number): string => {
  const thousands = Math.round(tokens / 1000)
  if (thousands >= 1000) return `${(thousands / 1000).toFixed(1)}M`
  if (tokens >= 1000) return `${thousands}k`
  return `${Math.round(tokens)}`
}

export const bar = (fraction: number): string => {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * BAR_CELLS)
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
}

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
    // event, so the band redraws on a timer as well.
    $.clock.every(30_000, () => $.ui.invalidate('ui.render'))

    return next(e)
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
    const [model, level, usage, lastCachedAt, now] = await Promise.all([
      $.session.model(),
      read($, effort),
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

    const segments: { key: string; color: string; text: string }[] = []

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
        key: 'C',
        color: 'cyan',
        text: `C ${bar(percent / 100)} ${Math.round(percent)}%${count}${expiry}`,
      })
    }

    for (const [key, kind, withDay] of [
      ['S', 'five_hour', false],
      ['W', 'seven_day', true],
    ] as const) {
      const limit = usage.rateLimits.find(one => one.kind === kind)
      if (!limit) continue
      segments.push({
        key,
        color: 'magenta',
        text: `${key} ${bar(limit.percentUsed / 100)} ${Math.round(limit.percentUsed)}%${resetText(limit, withDay)}`,
      })
    }

    return (
      <Box flexDirection="column">
        <Text color="gray">{'─'.repeat(e.props.bodyColumns)}</Text>
        <Box>
          <Text color="white" wrap="truncate">
            {model}
            {level ? ` [${level}]` : ''}
          </Text>
          {segments.map(segment => (
            <Text key={segment.key} wrap="truncate">
              <Text color="gray"> │ </Text>
              <Text color={segment.color}>{segment.text}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
