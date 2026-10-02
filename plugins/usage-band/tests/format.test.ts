import { expect, test } from 'claude-code/testing'

import { bar, formatTime, formatTokens, parseOffset } from '../hooks/register'

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
