'use strict'

// Adapted from Marked 18.0.11 Tokenizer.list and helpers.expandTabs (MIT).
// See vendor/LICENSE-MARKED. Keep item boundaries and task/loose-list behavior,
// but never expand content tabs when consuming structural indentation.
function expandTabs (line, indent = 0) {
  let column = indent, expanded = ''
  for (const char of line) {
    const width = char === '\t' ? 4 - column % 4 : 1
    expanded += char === '\t' ? ' '.repeat(width) : char
    column += width
  }
  return expanded
}

function stripListIndent (line, width, startColumn = 0) {
  let offset = 0, consumed = 0, column = startColumn
  while (offset < line.length && consumed < width && /[ \t]/.test(line[offset])) {
    const step = line[offset++] === '\t' ? 4 - column % 4 : 1
    column += step
    consumed += step
  }
  return { text: ' '.repeat(Math.max(0, consumed - width)) + line.slice(offset), column: startColumn + Math.min(consumed, width) }
}

// Use the paragraph rule to distinguish interrupting HTML (types1-6) from
// complete inline tags (type7), and ordered1 from non-interrupting ordered2.
function interruptsParagraph (rules, line) {
  if (!line.trim()) return true
  const paragraph = rules.block.paragraph.exec('OPEN\n' + line + '\n')
  return !paragraph || !paragraph[0].includes('\n' + line)
}

// Lazy continuation is only for paragraphs. A fence or HTML block must stop
// at a line that no longer belongs to the list item, even after body lines.
function itemLeafState (rules, depth = 0) {
  let fence = null, html = null, paragraph = false, quote = null, list = null
  return {
    canContinue: () => paragraph && !fence && !html,
    line (text, column, lazy = false) {
      if (lazy) return // An accepted lazy line cannot change the open leaf.
      const line = expandTabs(text, column)
      if (html) {
        if (html.test(line)) { html = null; paragraph = false }
        return
      }
      if (fence) {
        if (new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}[ \\t]*$').test(line)) fence = null
        return
      }
      const bullet = /^ {0,3}([*+-]|\d{1,9}[.)])([ \t]+|$)/.exec(line)
      const interruptingBullet = bullet && (!paragraph || quote || bullet[1].length === 1 || /^1[.)]$/.test(bullet[1])) && !rules.other.hrRegex(4).test(line)
      if (list) {
        const leading = line.search(/\S/)
        if (leading < 0 || leading >= list.indent) {
          list.state.line(leading < 0 ? '' : line.slice(list.indent), column + list.indent)
          paragraph = list.state.canContinue()
          return
        }
        const interrupts = interruptsParagraph(rules, line)
        if (list.state.canContinue() && !interrupts) { list.state.line(line, column, true); paragraph = list.state.canContinue(); return }
        list = null
      }
      if (interruptingBullet) {
        quote = null
        if (depth >= 256) throw new Error('Markdown 列表或引用嵌套过深')
        const padding = bullet[2].length > 4 ? 1 : bullet[2].length
        const indent = bullet[0].length - bullet[2].length + padding
        list = { indent, state: itemLeafState(rules, depth + 1) }
        list.state.line(line.slice(indent), column + indent)
        paragraph = list.state.canContinue()
        return
      }
      const marker = /^ {0,3}> ?/.exec(line)
      if (marker) {
        if (!quote) {
          if (depth >= 256) throw new Error('Markdown 列表或引用嵌套过深')
          quote = itemLeafState(rules, depth + 1)
        }
        quote.line(line.slice(marker[0].length), column + marker[0].length)
        paragraph = quote.canContinue()
        return
      }
      if (quote) {
        const interrupts = interruptsParagraph(rules, line)
        if (quote.canContinue() && !interrupts) { quote.line(line, column, true); paragraph = quote.canContinue(); return }
        quote = null
      }
      if (/^[ \t]*$/.test(line)) { paragraph = false; return }
      // Indented code cannot supply the paragraph needed for a later lazy
      // continuation, including when it is the leaf of nested containers.
      // Four spaces inside an already open paragraph still continue it.
      if (!paragraph && /^ {4}/.test(line)) return
      const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) { fence = opening[1]; paragraph = false; return }
      if ((!paragraph || interruptsParagraph(rules, line)) && rules.block.html.test(line + '\n')) {
        const literal = /^ {0,3}<(script|pre|style|textarea)(?:[ \t>]|$)/i.exec(line)
        const end = literal ? new RegExp('</' + literal[1] + '>', 'i') : /^ {0,3}<!--/.test(line) ? /-->/ : /^ {0,3}<\?/.test(line) ? /\?>/ : /^ {0,3}<!\[CDATA\[/.test(line) ? /\]\]>/ : /^ {0,3}<![A-Z]/.test(line) ? />/ : /^[ \t]*$/
        if (!end.test(line)) html = end
        paragraph = false
        return
      }
      paragraph = !(rules.other.headingBeginRegex(4).test(line) || rules.other.hrRegex(4).test(line) || (paragraph && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line)))
    }
  }
}

const taskStart = /^\[[ xX]\][ \t]+\S/
const taskPrefix = /^\[[ xX]\][ \t]+/

function listToken (src, hooks = {}) {
  let cap = this.rules.block.list.exec(src)
  if (cap) {
    const originAt = hooks.originAt || ((index, text) => ({ text, column: 0 }))
    let lineNumber = 0
    let bull = cap[1].trim()
    const isordered = bull.length > 1

    const list = {
      type: 'list',
      raw: '',
      ordered: isordered,
      start: isordered ? +bull.slice(0, -1) : '',
      loose: false,
      items: [],
    }

    bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`

    if (this.options.pedantic) {
      bull = isordered ? bull : '[*+-]'
    }

    // Get next list item
    const itemRegex = this.rules.other.listItemRegex(bull)
    let endsWithBlankLine = false
    // Check if current bullet point can start a new List Item
    while (src) {
      let endEarly = false
      let raw = ''
      let itemContents = ''
      const itemColumns = []
      const itemLazy = []
      if (!(cap = itemRegex.exec(src))) {
        break
      }

      if (this.rules.block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
        break
      }

      const firstOrigin = originAt(lineNumber, cap[0].split('\n', 1)[0])
      const marker = /^[ \t]*(?:[*+-]|\d{1,9}[.)])/.exec(firstOrigin.text)
      const firstBody = marker ? firstOrigin.text.slice(marker[0].length) : cap[2].split('\n', 1)[0]
      raw = cap[0]
      lineNumber += (raw.match(/\n/g) || []).length
      src = src.substring(raw.length)

      let line = expandTabs(firstBody, firstOrigin.column + cap[1].length)
      let nextLine = src.split('\n', 1)[0]
      let blankLine = !line.trim()

      let indent = 0
      if (this.options.pedantic) {
        indent = 2
        itemContents = line.trimStart()
      } else if (blankLine) {
        indent = cap[1].length + 1
      } else {
        indent = line.search(this.rules.other.nonSpaceChar); // Find first non-space char
        indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
        const content = stripListIndent(firstBody, indent, firstOrigin.column + cap[1].length)
        itemContents = content.text
        itemColumns.push(content.column)
        indent += cap[1].length
      }

      if (!itemColumns.length) itemColumns.push(firstOrigin.column + indent)
      itemLazy.push(Boolean(firstOrigin.lazy))
      const leaf = itemLeafState(this.rules)
      leaf.line(itemContents, itemColumns[0])
      if (blankLine && this.rules.other.blankLine.test(nextLine)) { // Items begin with at most one blank line
        raw += nextLine + '\n'
        lineNumber++
        src = src.substring(nextLine.length + 1)
        endEarly = true
      }

      if (!endEarly) {
        const nextBulletRegex = this.rules.other.nextBulletRegex(indent)
        const hrRegex = this.rules.other.hrRegex(indent)
        const fencesBeginRegex = this.rules.other.fencesBeginRegex(indent)
        const headingBeginRegex = this.rules.other.headingBeginRegex(indent)
        const htmlBeginRegex = this.rules.other.htmlBeginRegex(indent)
        const blockquoteBeginRegex = this.rules.other.blockquoteBeginRegex(indent)

        // Check if following lines should be included in List Item
        while (src) {
          const rawLine = src.split('\n', 1)[0]
          let nextLineWithoutTabs
          nextLine = rawLine
          const origin = originAt(lineNumber, rawLine)

          // Re-align to follow commonmark nesting rules
          if (this.options.pedantic) {
            nextLine = nextLine.replace(this.rules.other.listReplaceNesting, '  ')
            nextLineWithoutTabs = nextLine
          } else {
            nextLineWithoutTabs = expandTabs(nextLine, origin.column)
          }

          // End list item if found code fences
          if (fencesBeginRegex.test(nextLine)) {
            break
          }

          // End list item if found start of new heading
          if (headingBeginRegex.test(nextLine)) {
            break
          }

          // End list item if found start of html block
          if (htmlBeginRegex.test(nextLine)) {
            break
          }

          // End list item if found start of blockquote
          if (blockquoteBeginRegex.test(nextLine)) {
            break
          }

          // End list item if found start of new bullet
          if (nextBulletRegex.test(nextLine)) {
            break
          }

          // Horizontal rule found
          if (hrRegex.test(nextLine)) {
            break
          }

          if (nextLineWithoutTabs.search(this.rules.other.nonSpaceChar) >= indent || !nextLine.trim()) { // Dedent if possible
            const content = stripListIndent(origin.text, indent, origin.column)
            itemContents += '\n' + content.text
            itemColumns.push(content.column)
            itemLazy.push(Boolean(origin.lazy))
            leaf.line(content.text, content.column, Boolean(origin.lazy))
          } else {
            // not enough indentation
            if (blankLine || !leaf.canContinue()) {
              break
            }

            // The recursive leaf state above knows whether indentation belongs
            // to code or continues a paragraph. Rechecking the previous raw
            // line here misclassifies indented paragraph continuations.
            itemContents += '\n' + origin.text
            itemColumns.push(origin.column)
            itemLazy.push(true)
          }

          blankLine = !nextLine.trim()

          const lineEnding = src[rawLine.length] === '\n' ? '\n' : ''
          raw += rawLine + lineEnding
          lineNumber++
          src = src.substring(rawLine.length + lineEnding.length)
          line = nextLineWithoutTabs.slice(indent)
        }
      }

      if (!list.loose) {
        // If the previous item ended with a blank line, the list is loose
        if (endsWithBlankLine) {
          list.loose = true
        } else if (this.rules.other.doubleBlankLine.test(raw)) {
          endsWithBlankLine = true
        }
      }

      list.items.push({
        type: 'list_item',
        raw,
        task: !!this.options.gfm && taskStart.test(itemContents),
        loose: false,
        text: itemContents + (raw.endsWith('\n') ? '\n' : ''),
        tokens: [],
        sourceColumns: itemColumns,
        sourceLazy: itemLazy,
      })

      list.raw += raw
    }

    // The outer lexer consumes final separators; the child retains its physical ending.
    const lastItem = list.items.at(-1)
    if (lastItem) {
      lastItem.raw = lastItem.raw.trimEnd()
      // Keep physical line endings and payload whitespace in the item body.
    } else {
      // not a list since there were no items
      return
    }
    list.raw = list.raw.trimEnd()

    // First pass: tokenize items and finalize list.loose from spacers before placing checkboxes
    for (const item of list.items) {
      this.lexer.state.top = false
      item.tokens = hooks.parseItem ? hooks.parseItem(item.text, item.sourceColumns, item.sourceLazy) : this.lexer.blockTokens(item.text, [])
      delete item.sourceColumns
      delete item.sourceLazy

      if (!list.loose) {
        // Check if list should be loose
        let lastContent = item.tokens.length - 1
        while (lastContent >= 0 && item.tokens[lastContent].type === 'space') lastContent--
        const spacers = item.tokens.slice(0, lastContent).filter(t => t.type === 'space')
        const hasMultipleLineBreaks = spacers.some(t => this.rules.other.anyLine.test(t.raw)) || item.tokens.slice(0, lastContent).some(t => /\n[ \t]*\n$/.test(t.raw))

        list.loose = hasMultipleLineBreaks
      }
    }

    // Second pass: place task checkboxes using the final list.loose
    for (const item of list.items) {
      const itemToken = item.tokens[0]
      if (item.task && (itemToken?.type === 'text' || itemToken?.type === 'paragraph')) {
        // Remove checkbox markdown from item tokens
        item.text = item.text.replace(taskPrefix, '')
        itemToken.raw = itemToken.raw.replace(taskPrefix, '')
        itemToken.text = itemToken.text.replace(taskPrefix, '')
        for (let i = this.lexer.inlineQueue.length - 1; i >= 0; i--) {
          if (taskStart.test(this.lexer.inlineQueue[i].src)) {
            this.lexer.inlineQueue[i].src = this.lexer.inlineQueue[i].src.replace(taskPrefix, '')
            break
          }
        }

        const taskRaw = this.rules.other.listTaskCheckbox.exec(item.raw)
        if (taskRaw) {
          const checkboxToken = {
            type: 'checkbox',
            raw: taskRaw[0] + ' ',
            checked: taskRaw[0] !== '[ ]',
          }
          item.checked = checkboxToken.checked
          if (list.loose) {
            if (item.tokens[0] && ['paragraph', 'text'].includes(item.tokens[0].type) && 'tokens' in item.tokens[0] && item.tokens[0].tokens) {
              item.tokens[0].raw = checkboxToken.raw + item.tokens[0].raw
              item.tokens[0].text = checkboxToken.raw + item.tokens[0].text
              item.tokens[0].tokens.unshift(checkboxToken)
            } else {
              item.tokens.unshift({
                type: 'paragraph',
                raw: checkboxToken.raw,
                text: checkboxToken.raw,
                tokens: [checkboxToken],
              })
            }
          } else {
            item.tokens.unshift(checkboxToken)
          }
        }
      } else if (item.task) {
        item.task = false
      }
    }

    // Set all items to loose if list is loose
    if (list.loose) {
      for (const item of list.items) {
        item.loose = true
        for (const token of item.tokens) {
          if (token.type === 'text') {
            token.type = 'paragraph'
          }
        }
      }
    }

    return list
  }
}

module.exports = { listToken, interruptsParagraph }
