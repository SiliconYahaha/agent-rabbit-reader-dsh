'use strict'

// TeX 公式 → 可读 Unicode 纯文本。小程序没有 KaTeX/MathJax 可用，这里把常见命令、
// 希腊字母、运算符、上下标、分数、根号和 matrix/cases 环境转成排版文本。
// 移植自 AGI Bar 小程序 utils/document-renderer.js 的公式格式化部分（同一作者），
// 行为保持一致，便于两个项目渲染结果相同。

const TEX_COMMANDS = {
  // Greek lowercase
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  // Greek uppercase
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // Operators & relations
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', star: '⋆',
  circ: '∘', bullet: '∙', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠',
  ne: '≠', equiv: '≡', approx: '≈', sim: '∼', simeq: '≃', propto: '∝',
  ll: '≪', gg: '≫',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆',
  supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅',
  varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄', neg: '¬',
  lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  // Big operators & calculus
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭',
  oint: '∮', infty: '∞', partial: '∂', nabla: '∇',
  // Arrows
  to: '→', gets: '←', rightarrow: '→', leftarrow: '←', longrightarrow: '⟶',
  longleftarrow: '⟵', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
  Leftrightarrow: '⇔', mapsto: '↦', longmapsto: '⟼', uparrow: '↑',
  downarrow: '↓', nearrow: '↗', searrow: '↘', hookrightarrow: '↪',
  // Misc symbols
  ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', prime: '′',
  degree: '°', angle: '∠', measuredangle: '∡', perp: '⊥', parallel: '∥',
  therefore: '∴', because: '∵', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ',
  aleph: 'ℵ', wp: '℘', oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙',
  langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊',
  rfloor: '⌋', top: '⊤', bot: '⊥', models: '⊨', vdash: '⊢', dashv: '⊣',
  mid: '|', lVert: '‖', rVert: '‖', Vert: '‖', vert: '|', lvert: '|',
  rvert: '|', Backslash: '\\', lbrace: '{', rbrace: '}',
  suit: '♠', spadesuit: '♠', heartsuit: '♥', diamondsuit: '♦', clubsuit: '♣',
  checkmark: '✓', maltese: '✠'
}

// 直立函数名，不转符号。
const TEX_FUNCTIONS = [
  'lim', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos',
  'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'max', 'min',
  'sup', 'inf', 'limsup', 'liminf', 'det', 'gcd', 'arg', 'deg', 'dim',
  'hom', 'ker', 'mod', 'Pr', 'argmax', 'argmin', 'softmax', 'sigmoid',
  'relu', 'attention'
]

// 只影响排版、没有内容的命令，整体丢弃。
const TEX_DROPPED = {
  left: true, right: true, big: true, Big: true, bigg: true, Bigg: true,
  bigl: true, bigr: true, Bigl: true, Bigr: true, biggl: true, biggr: true,
  Biggl: true, Biggr: true, displaystyle: true, limits: true, nolimits: true,
  mathstrut: true, thinspace: true, medspace: true, thickspace: true,
  phantom: true, hphantom: true, vphantom: true, noalign: true, cr: true
}

const TEX_SPACING = { ',': ' ', ';': ' ', ':': ' ', ' ': ' ', '!': '', quad: '  ', qquad: '    ', enspace: ' ', newline: ' ' }

// 保留花括号内容、去掉包装命令本身。
const TEX_WRAPPERS = {
  mathrm: true, mathbf: true, mathit: true, mathsf: true, mathtt: true,
  mathcal: true, mathbb: true, mathfrak: true, text: true, textbf: true,
  textit: true, textrm: true, operatorname: true, boldsymbol: true,
  overline: true, underline: true, widehat: true, widetilde: true
}

const SUPERSCRIPTS = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶',
  7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽',
  ')': '⁾', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ',
  g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ',
  n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ',
  v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', T: 'ᵀ'
}

const SUBSCRIPTS = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆',
  7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍',
  ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ',
  l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ',
  t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ'
}

function readTexGroup (source, start) {
  if (source[start] === '{') {
    let depth = 1
    let index = start + 1
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') depth -= 1
      index += 1
    }
    if (depth === 0) return { content: source.slice(start + 1, index - 1), end: index }
  }
  if (source[start] === '\\') {
    const rest = /^\\[a-zA-Z]+/.exec(source.slice(start))
    if (rest) return { content: source.slice(start, start + rest[0].length), end: start + rest[0].length }
  }
  return { content: source[start] || '', end: start + 1 }
}

function toScriptChars (text, table, marker) {
  let output = ''
  for (const char of text) {
    if (table[char]) output += table[char]
    else if (char === '⊤') output += 'ᵀ'
    else if (char === ' ') continue
    else return `${marker}{${text}}`
  }
  return output
}

function isSimpleTexAtom (text) {
  return /^[0-9a-zA-Zα-ωΑ-Ω.]+$/.test(text) && text.length <= 12
}

// 已经整体带括号的内容，分数/根号里不再套一层。
function isWrappedTex (text) {
  return /^\([\s\S]*\)$/.test(text) || /^\{[\s\S]*\}$/.test(text)
}

// \begin{env}...\end{env}（matrix/cases/aligned…）变成多行文本网格：
// `\\` 分行，`&` 分格，每格递归格式化；行首尾包装符按环境族选择。
const TEX_ENV_WRAPPERS = {
  matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'],
  smallmatrix: ['', '']
}

function formatTexEnvironment (name, body) {
  const env = String(name || '').trim()
  const rows = String(body || '')
    .split(/\\\\/)
    .map(row => row.trim())
    .filter(row => row && row !== '\\hline' && row !== '\\hdashline')
  const isCases = env === 'cases' || env === 'dcases' || env === 'rcases'
  const [open, close] = isCases ? ['{ ', ''] : TEX_ENV_WRAPPERS[env] || ['', '']
  return rows.map(row => {
    const cells = row.split('&').map(cell => formatFormulaText(cell.trim()))
    const joined = cells.filter((cell, i) => cell || i === 0).join('  ').replace(/^\s+/, '')
    return `${open}${joined}${close}`.trimEnd()
  }).join('\n')
}

function formatTexWithEnvironments (source) {
  const envRegex = /\\begin\{([^}]+)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{\1\}/g
  let output = ''
  let cursor = 0
  let match = envRegex.exec(source)
  while (match) {
    const before = source.slice(cursor, match.index)
    if (before.trim()) output += `${formatFormulaText(before)}\n`
    output += formatTexEnvironment(match[1], match[2])
    cursor = match.index + match[0].length
    match = envRegex.exec(source)
  }
  const after = source.slice(cursor)
  if (after.trim()) output += `${output ? '\n' : ''}${formatFormulaText(after)}`
  return output
}

function formatFormulaText (tex) {
  const source = String(tex || '')
  if (/\\begin\{[^}]+\}/.test(source)) {
    // 网格用两个空格对齐，只裁行尾，保住对齐；普通路径会折叠多余空格。
    return formatTexWithEnvironments(source)
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .trim()
  }
  let index = 0
  let output = ''

  function readGroup () {
    const group = readTexGroup(source, index)
    index = group.end
    return group.content
  }

  while (index < source.length) {
    const char = source[index]
    if (char === '\\') {
      const nameMatch = /^\\([a-zA-Z]+|.)/.exec(source.slice(index))
      const name = nameMatch ? nameMatch[1] : ''
      index += name.length + 1
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const top = formatFormulaText(readGroup())
        const bottom = formatFormulaText(readGroup())
        const topText = isSimpleTexAtom(top) || isWrappedTex(top) ? top : `(${top})`
        const bottomText = isSimpleTexAtom(bottom) || isWrappedTex(bottom) ? bottom : `(${bottom})`
        // 只用 ASCII 斜杠：U+2044 在小程序常用衬线字体里会和相邻字符重叠。
        const separator = topText.length > 1 || bottomText.length > 1 ? ' / ' : '/'
        output += `${topText}${separator}${bottomText}`
      } else if (name === 'sqrt') {
        let order = ''
        if (source[index] === '[') {
          const close = source.indexOf(']', index)
          if (close >= 0) {
            order = source.slice(index + 1, close)
            index = close + 1
          }
        }
        const body = formatFormulaText(readGroup())
        const orderText = order ? toScriptChars(formatFormulaText(order), SUPERSCRIPTS, '^') : ''
        output += `${orderText}√${isSimpleTexAtom(body) ? body : `(${body})`}`
      } else if (TEX_WRAPPERS[name]) {
        output += formatFormulaText(readGroup())
      } else if (TEX_SPACING[name] !== undefined) {
        output += TEX_SPACING[name]
      } else if (TEX_DROPPED[name]) {
        // 纯排版命令，无内容。
      } else if (TEX_COMMANDS[name]) {
        output += TEX_COMMANDS[name]
      } else if (TEX_FUNCTIONS.includes(name)) {
        output += name
        // lim 一类的下限：无法用 Unicode 下标拼出时写成 lim(x → 0) 更可读。
        if (source[index] === '_') {
          index += 1
          const sub = formatFormulaText(readGroup())
          const converted = toScriptChars(sub, SUBSCRIPTS, '_')
          output += converted.startsWith('_{') ? `(${sub})` : converted
        }
      } else if (/^[a-zA-Z]+$/.test(name)) {
        // 未知命令原样保留（连同花括号参数），至少还是可辨认的 TeX。
        output += `\\${name}`
        if (source[index] === '{') {
          const group = readTexGroup(source, index)
          index = group.end
          output += `{${group.content}}`
        }
      } else {
        output += name
      }
      continue
    }
    if (char === '^' || char === '_') {
      index += 1
      const table = char === '^' ? SUPERSCRIPTS : SUBSCRIPTS
      output += toScriptChars(formatFormulaText(readGroup()), table, char)
      continue
    }
    if (char === '{' || char === '}') {
      index += 1
      continue
    }
    output += char
    index += 1
  }
  return output.replace(/[ \t]{2,}/g, ' ').trim()
}

// 公式块：去掉空白行，保留行结构。
function formatFormulaBlock (tex) {
  const raw = String(tex || '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .join('\n')
    .trim()
  return formatFormulaText(raw)
}

module.exports = { TEX_COMMANDS, TEX_FUNCTIONS, formatFormulaBlock, formatFormulaText }
