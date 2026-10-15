'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { deepQueryAll, installAutomatorQueryCompatibility } = require('../scripts/automator-deep-query')

test('deep selectors cross nested component scopes and return actual leaf handles', async () => {
  const leaf = { id: 4, pageId: 1, tap: () => 'actual-tap' }
  const skin = { id: 3, pageId: 1 }, reader = { id: 2, pageId: 1 }, page = { id: 1, pageId: 1 }
  const query = async (scope, selector) => {
    if (scope === page && selector === '#reader') return [reader]
    if (scope === reader && selector === 'component') return [skin]
    if (scope === skin && selector === '.entry-row') return [leaf]
    return []
  }
  const result = await deepQueryAll(page, '#reader >>> .entry-row', query)
  assert.deepEqual(result, [leaf])
  assert.equal(result[0].tap(), 'actual-tap')
  assert.deepEqual(await deepQueryAll(page, '#reader >>> .absent', query), [])
})

test('deep selector retains tree order and deduplicates projected component handles', async () => {
  const scopes = [0, 1, 2, 3].map(id => ({ id, pageId: 1 }))
  const leaves = [4, 5].map(id => ({ id, pageId: 1 }))
  const query = async (scope, selector) => {
    if (scope === scopes[0] && selector === '#reader') return [scopes[1]]
    if (selector === 'component') return scope === scopes[1] ? [scopes[2], scopes[3], scopes[2]] : []
    if (selector === '.row') return scope === scopes[2] ? [leaves[0]] : scope === scopes[3] ? [leaves[1]] : []
    return []
  }
  assert.deepEqual(await deepQueryAll(scopes[0], '#reader >>> .row', query), leaves)
  await assert.rejects(deepQueryAll(scopes[0], '#reader >>>', query), /Invalid deep selector/)
  await assert.rejects(deepQueryAll(scopes[0], '#reader >>> .row', async () => { throw Error('bridge unavailable') }), /bridge unavailable/)
})

test('compatibility install is idempotent and leaves host-page queries unchanged', async () => {
  class Page {
    async $ (selector) { return { original: selector } }
    async $$ (selector) { return selector === '#reader' ? [{ id: 2, pageId: 1, $$: async () => [] }] : [{ original: selector }] }
  }
  assert.equal(installAutomatorQueryCompatibility(Page), true)
  assert.equal(installAutomatorQueryCompatibility(Page), false)
  const page = new Page()
  assert.deepEqual(await page.$('.queue-button'), { original: '.queue-button' })
  assert.deepEqual(await page.$$('.queue-button'), [{ original: '.queue-button' }])
  assert.equal(await page.$('#reader >>> .missing'), null)
})
