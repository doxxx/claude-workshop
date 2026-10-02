import { expect, test } from 'claude-code/testing'

import {
  bar,
  formatTime,
  formatTokens,
  labelLength,
  mainTreePath,
  parseOffset,
  ruleFill,
  tildify,
} from '../hooks/register'

test('home becomes ~ as a whole component only', async () => {
  const home = '/home/gordon'
  expect(tildify(home, [[home, home]])).toBe('~')
  expect(tildify('/home/gordon/Projects', [['/home/gordon/Projects', home]])).toBe('~/Projects')
  expect(tildify('/home/gordon-old', [['/home/gordon-old', home]])).toBe('/home/gordon-old')
  // /home is a symlink to /var/home: only the resolved pair matches.
  expect(
    tildify('/var/home/gordon/x', [
      ['/var/home/gordon/x', home],
      ['/var/home/gordon/x', '/var/home/gordon'],
    ]),
  ).toBe('~/x')
  expect(tildify('/tmp', [['/tmp', home], ['', '']])).toBe('/tmp')
})

test('worktree paths read as the main tree', async () => {
  const common = '/repo/.git'
  expect(mainTreePath('/repo/.claude/worktrees/wt', '/repo/.claude/worktrees/wt', common)).toBe('/repo')
  expect(mainTreePath('/elsewhere/wt/src/a', '/elsewhere/wt', common)).toBe('/repo/src/a')
  expect(mainTreePath('/elsewhere/wt2', '/elsewhere/wt', common)).toBe('/elsewhere/wt2')
  expect(mainTreePath('/bare/wt', '/bare/wt', '/bare.git')).toBe('/bare/wt')
})

test('the rule fills to the width', async () => {
  const location = { path: '~/p', worktree: 'wt', branch: 'main' }
  // "~/p" + " {wt wt}" + " (main)"
  expect(labelLength(location)).toBe(3 + 8 + 7)
  expect(labelLength({ path: '~/p', worktree: null, branch: null })).toBe(3)
  expect(ruleFill(40, 18)).toBe(18)
  expect(ruleFill(10, 18)).toBe(1)
})

test('token counts render compactly', async () => {
  expect(formatTokens(850)).toBe('850')
  expect(formatTokens(45_200)).toBe('45k')
  expect(formatTokens(999_500)).toBe('1.0M')
  expect(formatTokens(1_234_000)).toBe('1.2M')
})

test('bars fill by fraction and clamp', async () => {
  expect(bar(0)).toBe('░░░░░░░░')
  expect(bar(0.5)).toBe('████░░░░')
  expect(bar(1.7)).toBe('████████')
  expect(bar(-1)).toBe('░░░░░░░░')
})

test('times use the host offset', async () => {
  expect(parseOffset('-0400\n')).toBe(-240)
  expect(parseOffset('+0530')).toBe(330)
  expect(parseOffset('junk')).toBe(null)
  // 2026-10-02T19:05:00Z is Fri 3:05 PM at -04:00.
  const at = Date.parse('2026-10-02T19:05:00Z')
  expect(formatTime(at, -240, false)).toBe('3:05 PM')
  expect(formatTime(at, -240, true)).toBe('Fri 3:05 PM')
  expect(formatTime(Date.parse('2026-10-02T04:00:00Z'), -240, false)).toBe('12:00 AM')
})
