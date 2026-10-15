'use strict'
// Exploration only: native differences are not chosen product contracts.
// Exhaustive eight stylesheet forms by four body positions; no random seed.
const sheets = {
  lowerNoDefault: String.raw`{\s1\v Hidden;}`,
  lowerWithDefault: String.raw`{\s0 Normal;}{\s1\v Hidden;}`,
  upperNoDefault: String.raw`{\S1\v Hidden;}`,
  bare: String.raw`{\v Hidden;}`,
  upperWithDefault: String.raw`{\s0 Normal;}{\S1\v Hidden;}`,
  hiddenDefault: String.raw`{\s0\v Hidden;}`,
  based: String.raw`{\s1\sbasedon0\v Hidden;}`,
  char: String.raw`{\*\cs1\additive\v Hidden;}`
}
const bodies = {
  start: String.raw`\s1 TEST`, middle: String.raw`A{\s1 TEST}Z`,
  paragraph: String.raw`A\par\s1 TEST\par\pard Z`, reset: String.raw`\pard\s1 TEST\par\pard Z`
}
const cases = Object.entries(sheets).flatMap(([sheet, definition]) => Object.entries(bodies).map(([body, text]) => ({ name: sheet + '-' + body, source: String.raw`{\rtf1\ansi{\stylesheet` + definition + '}' + text + '}' })))
module.exports = { cases }
