import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
  viewport: { columns: 100, rows: 40 },
} as const

// Every Box in the tree with a backgroundColor: the bars' tracks and fills.
const painted = (node: unknown, out: Record<string, unknown>[] = []) => {
  if (node && typeof node === 'object') {
    const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    if (element.type === 'Box' && element.props?.backgroundColor) out.push(element.props)
    for (const child of element.children ?? []) painted(child, out)
  }
  return out
}

const LIMITS = [
  { kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-03T18:00:00Z' },
  { kind: 'seven_day', percentUsed: 110, resetsAt: '2026-10-07T18:00:00Z' },
]

// store: what the mocked store starts with, or false where the test answers
// the store itself. rateLimits: the live windows, empty before a response.
const mockUsage = (
  on: Parameters<TestBody>[1],
  { store = {} as Record<string, unknown> | false, rateLimits = LIMITS } = {},
) => {
  mock.clock(on, { now: Date.parse('2026-10-03T16:00:00Z') })
  if (store) mock.store(on, store)
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      context: { tokens: 45_000, window: 200_000, percent: 22.5 },
      rateLimits,
    },
  }))
}

// What session.start reads beyond the store: an empty repo-less folder, the
// host offset +0000 and no settings.
const mockStart = (on: Parameters<TestBody>[1]) => {
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'this' }))
  on('session.cwd', async () => ({ value: '/p' }))
  on('settings.read', async () => ({ value: {} }))
  on('env.get', async () => ({ value: undefined }))
  on('process.run', async (_, e) => ({
    value: {
      exitCode: e.argv[0] === 'date' ? 0 : 128,
      stdout: e.argv[0] === 'date' ? '+0000\n' : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
}

const START = { cwd: '/p', surface: 'terminal', isInteractive: true } as const

test('each usage window draws a bar filled to its percentage', async ($, on) => {
  mockUsage(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, ...BAND })
    const fills = painted(await ui.drawn()).filter(props => props.backgroundColor !== 'promptBorder')
    expect(fills.map(props => props.width)).toEqual(['23%', '40%', '100%'])
    expect(fills.map(props => props.backgroundColor)).toEqual(['suggestion', 'permission', 'permission'])
    expect(await ui.find({ type: 'Text', text: /░|█/ })).toBeUndefined()
    for (const label of ['Context', 'Session', 'Weekly']) {
      expect(await ui.find({ type: 'Text', text: label + ' ' })).toBeDefined()
    }
    // The desktop shows the model and folder itself; the terminal band does.
    const model = await ui.find({ type: 'Text', text: /claude-opus-5-5/ })
    const rule = await ui.find({ type: 'Text', text: /──/ })
    if (surface === 'desktop') {
      expect(model).toBeUndefined()
      expect(rule).toBeUndefined()
    } else {
      expect(model).toBeDefined()
      expect(rule).toBeDefined()
    }
    await ui.unmount()
  }
})

test('a band too narrow for the bars side by side stacks them', async ($, on) => {
  mockUsage(on)

  for (const [columns, stacked] of [[100, false], [60, true]] as const) {
    const ui = await $.ui.mount({
      plugin: 'usage-band',
      surface: 'desktop',
      ...BAND,
      props: { ...BAND.props, bodyColumns: columns },
    })
    // Stacked, the labels pad to one width and lose the separators.
    expect(await ui.find({ type: 'Text', text: 'Weekly  ' })).toEqual(stacked ? expect.anything() : undefined)
    expect(await ui.find({ type: 'Text', text: ' │ ' })).toEqual(stacked ? undefined : expect.anything())
    // The texts pad on the left to the longest, " 110% (Wed 2:00 PM)".
    expect(await ui.find({ type: 'Text', text: /^ {6}40% \(/ })).toEqual(stacked ? expect.anything() : undefined)
    await ui.unmount()
  }
})

test('a restarted session brings back its cache expiry from the store', async ($, on) => {
  // The store is the test's own, so it can say what was dropped.
  mockUsage(on, { store: false })
  const day = 24 * 60 * 60 * 1000
  const now = Date.parse('2026-10-03T16:00:00Z')
  const store = new Map<string, unknown>([
    ['cachedAt:this', Date.parse('2026-10-03T15:30:00Z')],
    ['cachedAt:recent', now - day],
    ['cachedAt:stale', now - 31 * day],
  ])
  on('store.keys', async () => ({ value: [...store.keys()] }))
  on('store.get', async (_, e) => ({ value: store.get(e.key) }))
  on('store.delete', async (_, e) => (store.delete(e.key), { value: undefined }))
  mockStart(on)

  await $.session.start(START)
  expect([...store.keys()]).toEqual(['cachedAt:this', 'cachedAt:recent'])

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /23% 45k \(4:30 PM\)/ })).toBeDefined()
  await ui.unmount()
})

test('before a response the stored windows show as last known', async ($, on) => {
  // The session window reset at 15:00, before now; the weekly one has not.
  const stored = [{ ...LIMITS[0], resetsAt: '2026-10-03T15:00:00Z' }, LIMITS[1]]
  mockUsage(on, { store: { rateLimits: stored }, rateLimits: [] })
  mockStart(on)

  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /~110% \(Wed 6:00 PM\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Session ' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /~/ })).toBeDefined()
  await ui.unmount()
})

test('live windows show unmarked and are stored for the next session', async ($, on) => {
  mockUsage(on, { store: false })
  mockStart(on)
  const store = new Map<string, unknown>()
  on('store.keys', async () => ({ value: [...store.keys()] }))
  on('store.get', async (_, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('session.measure', async (_, e) => ({ changed: e.changed }))

  await $.session.start(START)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: LIMITS, changed: ['rateLimits'] })
  expect(store.get('rateLimits')).toEqual(LIMITS)

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /40% \(6:00 PM\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~/ })).toBeUndefined()
  await ui.unmount()
})
