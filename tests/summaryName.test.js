/**
 * Tests for harvesting system names out of SaveSummary text — the only name
 * source for stationless, unrenamed systems — and the two-save confirmation
 * that guards against SaveSummary lagging a warp behind UniversalAddress.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  systemNameFromSummary,
  SummaryNameTracker
} = require('./.build/main/services/summaryName.js')

test('systemNameFromSummary: extracts the name from in-system summaries', () => {
  assert.strictEqual(systemNameFromSummary('In the Vadorca system'), 'Vadorca')
  assert.strictEqual(systemNameFromSummary('Within Rerasmutul system'), 'Rerasmutul')
  assert.strictEqual(systemNameFromSummary('  In the Nuwardia system  '), 'Nuwardia')
})

test('systemNameFromSummary: other summary shapes yield nothing', () => {
  assert.strictEqual(systemNameFromSummary('Aboard Elunbod Station Minor'), null)
  assert.strictEqual(systemNameFromSummary('Aboard the Space Anomaly'), null)
  assert.strictEqual(systemNameFromSummary('On planet Miur IX'), null)
  assert.strictEqual(systemNameFromSummary(''), null)
  assert.strictEqual(systemNameFromSummary(null), null)
  assert.strictEqual(systemNameFromSummary('In the system'), null)
})

test('tracker: a name confirms only on a second, distinct save write', () => {
  const tracker = new SummaryNameTracker()
  assert.strictEqual(tracker.observe('R0:1:2:3:424', 'In the Vadorca system', 1000), null)
  // Re-processing the same save (slot re-pin, duplicate watcher event)
  // must not self-confirm.
  assert.strictEqual(tracker.observe('R0:1:2:3:424', 'In the Vadorca system', 1000), null)
  assert.strictEqual(
    tracker.observe('R0:1:2:3:424', 'In the Vadorca system', 2000),
    'Vadorca'
  )
})

test('tracker: a stale summary against a fresh address never confirms', () => {
  const tracker = new SummaryNameTracker()
  // Save in the old system, then a warp where the summary lagged one save.
  assert.strictEqual(tracker.observe('R0:1:2:3:424', 'In the Vadorca system', 1000), null)
  assert.strictEqual(tracker.observe('R0:1:2:3:514', 'In the Vadorca system', 2000), null)
  // The next save has a refreshed summary; the stale pair is discarded.
  assert.strictEqual(tracker.observe('R0:1:2:3:514', 'In the Ehmedh system', 3000), null)
  assert.strictEqual(tracker.observe('R0:1:2:3:514', 'In the Ehmedh system', 4000), 'Ehmedh')
})

test('tracker: summaries without a system name are ignored, keeping the pending pair', () => {
  const tracker = new SummaryNameTracker()
  assert.strictEqual(tracker.observe('R0:1:2:3:424', 'In the Vadorca system', 1000), null)
  assert.strictEqual(tracker.observe('R0:1:2:3:424', 'Aboard the Space Anomaly', 2000), null)
  assert.strictEqual(
    tracker.observe('R0:1:2:3:424', 'In the Vadorca system', 3000),
    'Vadorca'
  )
})
