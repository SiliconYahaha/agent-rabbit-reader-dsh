'use strict'
const test = require('node:test')
const { verify } = require('../scripts/verify-media-lifecycle')

test('official WeChat framework preserves real skin event identity across same-path replacement and HTML', () => {
  verify()
})
