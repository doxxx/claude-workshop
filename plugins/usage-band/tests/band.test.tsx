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

const mockUsage = (on: Parameters<TestBody>[1]) => {
  mock.clock(on, { now: Date.parse('2026-10-03T16:00:00Z') })
  mock.store(on, {})
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      context: { tokens: 45_000, window: 200_000, percent: 22.5 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-03T18:00:00Z' },
        { kind: 'seven_day', percentUsed: 110, resetsAt: '2026-10-07T18:00:00Z' },
      ],
    },
  }))
}

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
