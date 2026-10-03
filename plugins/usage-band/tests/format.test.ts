import { expect, test } from 'claude-code/testing'

import {
  bar,
  branchText,
  formatTime,
  formatTokens,
  labelLength,
  mainTreePath,
  parseOffset,
  parseStatus,
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

const clean = { ahead: 0, behind: 0, modified: 0 }

test('git status gives ahead, behind and modified counts', async () => {
  const text = [
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b hooks/register.tsx',
    '1 M. N... 100644 100644 100644 a b README.md',
    '',
  ].join('\n')
  expect(parseStatus(text)).toEqual({ ahead: 2, behind: 1, modified: 2 })
  expect(parseStatus('# branch.head main\n')).toEqual(clean)
  expect(parseStatus('')).toEqual(clean)
})

test('the branch text leads with the nonzero counts', async () => {
  const base = { path: '~/p', worktree: null, branch: 'main' }
  expect(branchText({ ...base, ...clean })).toBe('main')
  expect(branchText({ ...base, ahead: 2, behind: 1, modified: 3 })).toBe('↓1 ↑2 *3 main')
  expect(branchText({ ...base, ...clean, modified: 4 })).toBe('*4 main')
})

test('the rule fills to the width', async () => {
  const location = { path: '~/p', worktree: 'wt', branch: 'main', ...clean }
  // "~/p" + " {wt wt}" + " (main)"
  expect(labelLength(location)).toBe(3 + 8 + 7)
  // " (↓1 *3 main)"
  expect(labelLength({ ...location, behind: 1, modified: 3 })).toBe(3 + 8 + 13)
  expect(labelLength({ path: '~/p', worktree: null, branch: null, ...clean })).toBe(3)
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
