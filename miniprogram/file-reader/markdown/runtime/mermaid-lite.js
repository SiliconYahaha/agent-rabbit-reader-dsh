'use strict'

// mermaid-lite：无依赖的 Mermaid 子集渲染器，输出 SVG 字符串。小程序里跑不了 Mermaid
//（它需要 DOM），但 <image> 能显示 SVG data URI。支持 flowchart/graph（分层布局）、
// sequenceDiagram、stateDiagram(-v2)、gantt；其他图类型返回 null，由调用方显示占位。
// 移植自 AGI Bar 小程序 utils/mermaid-lite.js（同一作者），配色可通过 options.colors 覆盖。

const SVG_FONT = 'PingFang SC, Helvetica Neue, Arial, sans-serif'

const DEFAULT_COLORS = Object.freeze({
  ink: '#3d3428',
  muted: '#8a857a',
  line: '#a89e8d',
  nodeFill: '#fbf7ec',
  nodeStroke: '#c7963c',
  decisionFill: '#f9eed1',
  actorFill: '#fbf7ec',
  actorStroke: '#b17920',
  edge: '#8a857a',
  labelBg: '#ffffff',
  done: '#7a9b5a',
  active: '#c7963c',
  task: '#cbbfa8',
  crit: '#c2413a',
  grid: 'rgba(58, 50, 38, 0.12)'
})

const DIAGRAM_LABELS = Object.freeze({
  flowchart: '流程图', graph: '流程图', sequenceDiagram: '时序图',
  stateDiagram: '状态图', 'stateDiagram-v2': '状态图', gantt: '甘特图',
  pie: '饼图', erDiagram: 'ER 图', classDiagram: '类图', journey: '用户旅程图',
  gitGraph: 'Git 图', mindmap: '思维导图', timeline: '时间线'
})

function estimateTextWidth (text, fontSize) {
  let width = 0
  for (const char of String(text || '')) {
    // 中日韩与全角标点占一个 em，拉丁与数字约 0.56em。
    width += /[⺀-鿿豈-﫿︰-﹏＀-￠]/.test(char) ? fontSize : fontSize * 0.56
  }
  return width
}

function escapeXml (value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapLabel (text, maxWidth, fontSize) {
  const raw = String(text || '').trim()
  if (estimateTextWidth(raw, fontSize) <= maxWidth) return [raw]
  const lines = []
  let current = ''
  for (const char of raw) {
    if (estimateTextWidth(current + char, fontSize) > maxWidth && current) {
      lines.push(current)
      current = char
    } else {
      current += char
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Flowchart / stateDiagram（共用分层布局）

const SHAPE_PATTERNS = [
  { regex: /\(\((.+?)\)\)$/, shape: 'circle' },
  { regex: /\[\[(.+?)\]\]$/, shape: 'subroutine' },
  { regex: /\[\((.+?)\)\]$/, shape: 'cylinder' },
  { regex: /\(\[(.+?)\]\)$/, shape: 'stadium' },
  { regex: /\[(.+?)\]$/, shape: 'rect' },
  { regex: /\((.+?)\)$/, shape: 'stadium' },
  { regex: /\{(.+?)\}$/, shape: 'diamond' },
  { regex: />(.+?)\]$/, shape: 'asym' }
]

function parseNodeRef (token) {
  const raw = String(token || '').trim()
  const match = raw.match(/^([A-Za-z0-9_一-鿿]+)(.*)$/)
  if (!match) return null
  const id = match[1]
  const rest = (match[2] || '').trim()
  if (!rest) return { id, label: id, shape: 'rect', implicit: true }
  for (const pattern of SHAPE_PATTERNS) {
    const shapeMatch = rest.match(pattern.regex)
    if (shapeMatch) return { id, label: shapeMatch[1].trim(), shape: pattern.shape, implicit: false }
  }
  return { id, label: id, shape: 'rect', implicit: true }
}

function parseFlowChart (code) {
  const lines = String(code || '').split('\n')
  let direction = 'TD'
  const edges = []
  const nodes = new Map()
  let started = false

  function ensureNode (token) {
    const ref = parseNodeRef(token)
    if (!ref) return null
    if (!nodes.has(ref.id) || !nodes.get(ref.id).explicit) {
      nodes.set(ref.id, { id: ref.id, label: ref.label, shape: ref.shape, explicit: !ref.implicit })
    }
    return ref.id
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('%%')) continue
    const header = line.match(/^(?:flowchart|graph|stateDiagram(?:-v2)?)\s*(TD|TB|BT|LR|RL)?/i)
    if (header && !started) {
      started = true
      direction = header[1] || 'TD'
      continue
    }
    if (/^(subgraph|end|style|classDef|class|linkStyle)\b/i.test(line)) continue
    const directionLine = line.match(/^direction\s+(TD|TB|BT|LR|RL)/i)
    if (directionLine) {
      direction = directionLine[1].toUpperCase()
      continue
    }

    // 状态图的标签写法：A --> B: text
    let label = ''
    let body = line
      .replace(/--(?!>)\s*([^-|=][^-|]*?)\s*-->/g, '-->|$1|')
      .replace(/-\.\s*([^-.]*?)\s*\.->/g, '-.->|$1|')
    const colonLabel = body.match(/^(.+?)\s*:\s*(.+)$/)
    if (colonLabel && colonLabel[1].indexOf('--') >= 0) {
      body = colonLabel[1]
      label = colonLabel[2].trim()
    }

    // 按边操作符切链：A --> B -.-> C ==> D
    const parts = body.split(/\s*(-\.->|-->|---|==>|-\.-|===)\s*/)
    if (parts.length < 3) continue
    let prevId = ensureNode(parts[0])
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const op = parts[i]
      let target = parts[i + 1]
      const pipeLabel = target.match(/^\|([^|]*)\|\s*(.*)$/)
      if (pipeLabel) {
        label = pipeLabel[1].trim() || label
        target = pipeLabel[2]
      }
      const nextId = ensureNode(target)
      if (prevId && nextId) {
        edges.push({
          from: prevId,
          to: nextId,
          label,
          style: op === '-.->' || op === '-.-' ? 'dashed' : op === '==>' || op === '===' ? 'thick' : 'solid',
          arrow: op !== '---' && op !== '-.-' && op !== '==='
        })
      }
      label = ''
      prevId = nextId
    }
  }
  if (!nodes.size) return null
  return { direction, nodes: [...nodes.values()], edges }
}

function layoutLayered (graph, options) {
  const opts = options || {}
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL'
  const fontSize = opts.fontSize || 13
  const nodeH = opts.nodeH || 44
  const gapX = opts.gapX || 56
  const gapY = opts.gapY || 46

  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  for (const node of graph.nodes) {
    // 状态图端点已预设尺寸，不再计算。
    if (node.lines === undefined) node.lines = wrapLabel(node.label, 150, fontSize)
    if (node.w === undefined) {
      node.w = Math.max(64, Math.ceil(Math.max(...node.lines.map(line => estimateTextWidth(line, fontSize))) + 28))
    }
    if (node.h === undefined) {
      node.h = node.shape === 'diamond' ? Math.max(56, node.lines.length * 18 + 30) : Math.max(nodeH, node.lines.length * 18 + 16)
    }
    node.incoming = []
    node.outgoing = []
  }
  for (const edge of graph.edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from && to) {
      from.outgoing.push(edge)
      to.incoming.push(edge)
    }
  }

  // 从根节点做最长路径分层（有环时靠访问上限收敛）。
  const layer = new Map()
  const roots = graph.nodes.filter(node => !node.incoming.length)
  const queue = (roots.length ? roots : graph.nodes.slice(0, 1)).map(node => node.id)
  for (const id of queue) layer.set(id, 0)
  let guard = graph.nodes.length * 8
  while (queue.length && guard > 0) {
    guard -= 1
    const id = queue.shift()
    const node = byId.get(id)
    for (const edge of node.outgoing) {
      const next = Math.max(layer.get(edge.to) || 0, (layer.get(id) || 0) + 1)
      if (next !== layer.get(edge.to)) {
        layer.set(edge.to, next)
        queue.push(edge.to)
      }
    }
  }
  for (const node of graph.nodes) {
    if (!layer.has(node.id)) layer.set(node.id, 0)
  }

  const layers = []
  for (const node of graph.nodes) {
    const l = layer.get(node.id)
    node.layer = l;
    (layers[l] = layers[l] || []).push(node)
  }

  // 重心排序，往返各扫两遍。
  const posOf = node => node.order
  for (let sweep = 0; sweep < 3; sweep += 1) {
    for (const layerNodes of layers) {
      if (!layerNodes) continue
      for (const node of layerNodes) {
        const refs = (sweep % 2 === 0 ? node.incoming : node.outgoing)
          .map(edge => byId.get(sweep % 2 === 0 ? edge.from : edge.to))
          .filter(ref => ref && ref.order !== undefined)
        if (refs.length) {
          node.bary = refs.reduce((sum, ref) => sum + posOf(ref), 0) / refs.length
        }
      }
      layerNodes.sort((a, b) => (a.bary ?? a.order ?? 0) - (b.bary ?? b.order ?? 0))
      layerNodes.forEach((node, orderIndex) => {
        node.order = orderIndex
        delete node.bary
      })
    }
  }

  let maxMain = 0
  for (const layerNodes of layers) {
    if (!layerNodes) continue
    let main = 0
    layerNodes.forEach((node, orderIndex) => {
      node.order = orderIndex
      main += (horizontal ? node.h : node.w) + gapY
    })
    maxMain = Math.max(maxMain, main - gapY)
  }

  let cursorCross = 24
  for (const layerNodes of layers) {
    if (!layerNodes) continue
    const layerCross = Math.max(...layerNodes.map(node => (horizontal ? node.w : node.h)))
    let cursorMain = 24 + (maxMain - (layerNodes.reduce((sum, node) => sum + (horizontal ? node.h : node.w) + gapY, -gapY))) / 2
    for (const node of layerNodes) {
      const main = horizontal ? node.h : node.w
      if (horizontal) {
        node.cx = cursorCross + layerCross / 2
        node.cy = cursorMain + main / 2
      } else {
        node.cx = cursorMain + main / 2
        node.cy = cursorCross + layerCross / 2
      }
      cursorMain += main + gapY
    }
    cursorCross += layerCross + gapX
  }

  const width = horizontal ? cursorCross - gapX + 24 : maxMain + 48
  const height = horizontal ? maxMain + 48 : cursorCross - gapX + 24
  return { byId, horizontal, width, height }
}

function nodeAnchor (node, toward) {
  const dx = toward.x - node.cx
  const dy = toward.y - node.cy
  const halfW = node.w / 2
  const halfH = node.h / 2
  if (!dx && !dy) return { x: node.cx, y: node.cy }
  const scaleX = dx ? halfW / Math.abs(dx) : Infinity
  const scaleY = dy ? halfH / Math.abs(dy) : Infinity
  const scale = Math.min(scaleX, scaleY)
  return { x: node.cx + dx * scale, y: node.cy + dy * scale }
}

function createPainter (colors) {
  const COLORS = { ...DEFAULT_COLORS, ...(colors || {}) }

  function svgText (x, y, text, options) {
    const opts = options || {}
    const size = opts.size || 13
    const anchor = opts.anchor || 'middle'
    const fill = opts.fill || COLORS.ink
    const weight = opts.weight ? ` font-weight="${opts.weight}"` : ''
    return `<text x="${x}" y="${y}" font-size="${size}" font-family="${SVG_FONT}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central"${weight}>${escapeXml(text)}</text>`
  }

  function svgDocument (width, height, body) {
    const defs = `<defs><marker id="ml-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${COLORS.edge}"/></marker></defs>`
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}">${defs}${body}</svg>`
  }

  function drawFlowNode (node, fontSize) {
    const parts = []
    const fill = node.shape === 'diamond' ? COLORS.decisionFill : COLORS.nodeFill
    const stroke = COLORS.nodeStroke
    if (node.shape === 'diamond') {
      const w = node.w * 0.78
      const h = node.h * 0.62
      parts.push(`<polygon points="${node.cx},${node.cy - h} ${node.cx + w},${node.cy} ${node.cx},${node.cy + h} ${node.cx - w},${node.cy}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
    } else if (node.shape === 'stadium') {
      parts.push(`<rect x="${node.cx - node.w / 2}" y="${node.cy - node.h / 2}" width="${node.w}" height="${node.h}" rx="${node.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
    } else if (node.shape === 'circle') {
      const r = Math.max(node.w, node.h) / 2
      parts.push(`<circle cx="${node.cx}" cy="${node.cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
    } else if (node.shape === 'subroutine') {
      parts.push(`<rect x="${node.cx - node.w / 2}" y="${node.cy - node.h / 2}" width="${node.w}" height="${node.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
      parts.push(`<line x1="${node.cx - node.w / 2 + 7}" y1="${node.cy - node.h / 2}" x2="${node.cx - node.w / 2 + 7}" y2="${node.cy + node.h / 2}" stroke="${stroke}" stroke-width="1.2"/>`)
      parts.push(`<line x1="${node.cx + node.w / 2 - 7}" y1="${node.cy - node.h / 2}" x2="${node.cx + node.w / 2 - 7}" y2="${node.cy + node.h / 2}" stroke="${stroke}" stroke-width="1.2"/>`)
    } else if (node.shape === 'cylinder') {
      const x0 = node.cx - node.w / 2
      const y0 = node.cy - node.h / 2
      const ry = Math.min(9, node.h / 4)
      parts.push(`<path d="M ${x0} ${y0 + ry} A ${node.w / 2} ${ry} 0 0 0 ${x0 + node.w} ${y0 + ry} L ${x0 + node.w} ${y0 + node.h - ry} A ${node.w / 2} ${ry} 0 0 1 ${x0} ${y0 + node.h - ry} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
      parts.push(`<path d="M ${x0} ${y0 + ry} A ${node.w / 2} ${ry} 0 0 1 ${x0 + node.w} ${y0 + ry}" fill="none" stroke="${stroke}" stroke-width="1.2"/>`)
    } else if (node.shape === 'state-dot') {
      parts.push(`<circle cx="${node.cx}" cy="${node.cy}" r="9" fill="${COLORS.ink}"/>`)
    } else if (node.shape === 'state-ring') {
      parts.push(`<circle cx="${node.cx}" cy="${node.cy}" r="10" fill="none" stroke="${COLORS.ink}" stroke-width="2.5"/><circle cx="${node.cx}" cy="${node.cy}" r="4.5" fill="${COLORS.ink}"/>`)
    } else {
      parts.push(`<rect x="${node.cx - node.w / 2}" y="${node.cy - node.h / 2}" width="${node.w}" height="${node.h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
    }
    const lines = node.lines || [node.label]
    const startY = node.cy - ((lines.length - 1) * (fontSize + 4)) / 2
    lines.forEach((line, lineIndex) => {
      parts.push(svgText(node.cx, startY + lineIndex * (fontSize + 4), line, { size: fontSize }))
    })
    return parts.join('')
  }

  function renderFlowChart (code) {
    const graph = parseFlowChart(code)
    if (!graph) return null
    const fontSize = 13
    const layout = layoutLayered(graph, { fontSize })
    const parts = []
    const edgeKeys = new Set(graph.edges.map(edge => `${edge.from}->${edge.to}`))

    for (const edge of graph.edges) {
      const from = layout.byId.get(edge.from)
      const to = layout.byId.get(edge.to)
      if (!from || !to) continue
      if (from === to) {
        const r = 22
        parts.push(`<path d="M ${from.cx + from.w / 2} ${from.cy - 8} C ${from.cx + from.w / 2 + r} ${from.cy - r - 12}, ${from.cx + from.w / 2 + r} ${from.cy + r + 4}, ${from.cx + from.w / 2} ${from.cy + 8}" fill="none" stroke="${COLORS.edge}" stroke-width="1.4" marker-end="url(#ml-arrow)"/>`)
        continue
      }
      const start = nodeAnchor(from, { x: to.cx, y: to.cy })
      const end = nodeAnchor(to, { x: from.cx, y: from.cy })
      const dashed = edge.style === 'dashed' ? ' stroke-dasharray="6 4"' : ''
      const width = edge.style === 'thick' ? 2.4 : 1.4
      const marker = edge.arrow || edge.style === 'thick' ? ' marker-end="url(#ml-arrow)"' : ''
      const stroke = `stroke="${COLORS.edge}" stroke-width="${width}"${dashed}${marker}`
      const twoWay = edgeKeys.has(`${edge.to}->${edge.from}`)
      const span = Math.abs((to.layer || 0) - (from.layer || 0))
      let labelPoint
      if (twoWay) {
        // 双向边共用中点，各自向右弯一点，两条都能看见。
        const mx = (start.x + end.x) / 2
        const my = (start.y + end.y) / 2
        const dx = end.x - start.x
        const dy = end.y - start.y
        const len = Math.hypot(dx, dy) || 1
        const cxp = mx + (-dy / len) * 26
        const cyp = my + (dx / len) * 26
        parts.push(`<path d="M ${start.x} ${start.y} Q ${cxp} ${cyp} ${end.x} ${end.y}" fill="none" ${stroke}/>`)
        labelPoint = { x: (start.x + 2 * cxp + end.x) / 4, y: (start.y + 2 * cyp + end.y) / 4 }
      } else if (span > 1) {
        // 跨层长边侧向绕开中间节点。
        let maxHalf = 20
        for (const node of graph.nodes) {
          const between = (node.layer || 0) > Math.min(from.layer, to.layer) && (node.layer || 0) < Math.max(from.layer, to.layer)
          if (between) maxHalf = Math.max(maxHalf, (layout.horizontal ? node.h : node.w) / 2 + 20)
        }
        const bow = maxHalf + 26
        const midX = (start.x + end.x) / 2
        const midY = (start.y + end.y) / 2
        if (layout.horizontal) {
          parts.push(`<path d="M ${start.x} ${start.y} C ${midX} ${start.y + bow}, ${midX} ${end.y + bow}, ${end.x} ${end.y}" fill="none" ${stroke}/>`)
          labelPoint = { x: midX, y: midY + 0.75 * bow }
        } else {
          parts.push(`<path d="M ${start.x} ${start.y} C ${start.x + bow} ${midY}, ${end.x + bow} ${midY}, ${end.x} ${end.y}" fill="none" ${stroke}/>`)
          labelPoint = { x: midX + 0.75 * bow, y: midY }
        }
      } else {
        parts.push(`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" ${stroke}/>`)
        labelPoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      }
      if (edge.label) {
        const labelWidth = estimateTextWidth(edge.label, 12) + 10
        parts.push(`<rect x="${labelPoint.x - labelWidth / 2}" y="${labelPoint.y - 10}" width="${labelWidth}" height="20" rx="4" fill="${COLORS.labelBg}"/>`)
        parts.push(svgText(labelPoint.x, labelPoint.y, edge.label, { size: 12, fill: COLORS.muted }))
      }
    }
    for (const node of graph.nodes) parts.push(drawFlowNode(node, fontSize))

    return svgDocument(layout.width, layout.height, parts.join(''))
  }

  function renderStateDiagram (code) {
    // 箭头左边的 [*] 是起点实心圆，右边的是终点环。
    const normalized = String(code || '')
      .replace(/^\s*stateDiagram(-v2)?\s*$/im, 'flowchart TD')
      .replace(/\[\*\](\s*(?:-->|---|-\.->|==>))/g, 'S__dot$1')
      .replace(/((?:-->|---|-\.->|==>)\s*)\[\*\]/g, '$1E__ring')
    const graph = parseFlowChart(normalized)
    if (!graph) return null
    for (const node of graph.nodes) {
      if (node.id === 'S__dot') {
        node.shape = 'state-dot'
        node.lines = []
        node.w = 18
        node.h = 18
      } else if (node.id === 'E__ring') {
        node.shape = 'state-ring'
        node.lines = []
        node.w = 20
        node.h = 20
      }
    }
    const fontSize = 13
    const layout = layoutLayered(graph, { fontSize })
    const parts = []
    for (const edge of graph.edges) {
      const from = layout.byId.get(edge.from)
      const to = layout.byId.get(edge.to)
      if (!from || !to) continue
      const start = nodeAnchor(from, { x: to.cx, y: to.cy })
      const end = nodeAnchor(to, { x: from.cx, y: from.cy })
      parts.push(`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${COLORS.edge}" stroke-width="1.4" marker-end="url(#ml-arrow)"/>`)
      if (edge.label) {
        const mx = (start.x + end.x) / 2
        const my = (start.y + end.y) / 2
        const labelWidth = estimateTextWidth(edge.label, 12) + 10
        parts.push(`<rect x="${mx - labelWidth / 2}" y="${my - 10}" width="${labelWidth}" height="20" rx="4" fill="${COLORS.labelBg}"/>`)
        parts.push(svgText(mx, my, edge.label, { size: 12, fill: COLORS.muted }))
      }
    }
    for (const node of graph.nodes) parts.push(drawFlowNode(node, fontSize))
    return svgDocument(layout.width, layout.height, parts.join(''))
  }

  // -------------------------------------------------------------------------
  // 时序图

  function renderSequenceDiagram (code) {
    const participants = []
    const byName = new Map()
    const messages = []
    let started = false

    function ensureParticipant (name, label) {
      const key = String(name || '').trim()
      if (!key) return null
      if (!byName.has(key)) {
        byName.set(key, { name: key, label: label || key })
        participants.push(byName.get(key))
      } else if (label) {
        byName.get(key).label = label
      }
      return byName.get(key)
    }

    for (const rawLine of String(code || '').split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('%%')) continue
      if (/^sequenceDiagram/i.test(line)) {
        started = true
        continue
      }
      if (!started) continue
      const participant = line.match(/^(?:participant|actor)\s+([A-Za-z0-9_一-鿿]+)(?:\s+as\s+(.+))?$/i)
      if (participant) {
        ensureParticipant(participant[1], (participant[2] || '').trim())
        continue
      }
      if (/^(autonumber|title\b|activate|deactivate|loop|alt|else|opt|par|critical|break|rect)\b/i.test(line)) continue
      const note = line.match(/^Note\s+(over|left of|right of)\s+(.+?)\s*:\s*(.+)$/i)
      if (note) {
        const targets = note[2].split(',').map(part => ensureParticipant(part.trim()))
        messages.push({ type: 'note', side: note[1].toLowerCase(), targets: targets.filter(Boolean), text: note[3].trim() })
        continue
      }
      const message = line.match(/^([A-Za-z0-9_一-鿿]+)\s*(-->>|->>|--\)|->|-x)\s*([A-Za-z0-9_一-鿿]+)\s*:\s*(.+)$/)
      if (message) {
        const from = ensureParticipant(message[1])
        const to = ensureParticipant(message[3])
        messages.push({
          type: 'message',
          from,
          to,
          dashed: message[2] === '-->>' || message[2] === '--)',
          lost: message[2] === '-x',
          text: message[4].trim()
        })
      }
    }
    if (participants.length < 2 || !messages.length) return null

    const fontSize = 13
    const padX = 28
    const actorH = 40
    const rowH = 52
    const noteH = 30
    const top = 24
    const gapX = 150

    const actorW = participants.map(p => Math.max(72, estimateTextWidth(p.label, fontSize) + 30))
    const xs = []
    let cursor = padX
    participants.forEach((participant, i) => {
      xs.push(cursor + actorW[i] / 2)
      cursor += actorW[i] + gapX
    })
    const width = cursor - gapX + padX

    let y = top + actorH + 28
    const parts = []
    for (const message of messages) {
      if (message.type === 'note') {
        const x1 = xs[participants.indexOf(message.targets[0])]
        const x2 = message.targets[1] ? xs[participants.indexOf(message.targets[1])] : x1
        const noteW = Math.max(estimateTextWidth(message.text, 12) + 20, x2 - x1 + 40)
        parts.push(`<rect x="${(x1 + x2) / 2 - noteW / 2}" y="${y - noteH / 2}" width="${noteW}" height="${noteH}" rx="4" fill="${COLORS.decisionFill}" stroke="${COLORS.nodeStroke}" stroke-width="1"/>`)
        parts.push(svgText((x1 + x2) / 2, y, message.text, { size: 12 }))
        y += noteH + 16
        continue
      }
      const fromX = xs[participants.indexOf(message.from)]
      const toX = xs[participants.indexOf(message.to)]
      const labelY = y - 8
      if (message.from === message.to) {
        const loopW = 40
        const loopH = 26
        parts.push(svgText(fromX + loopW + 4, y, message.text, { size: 12, anchor: 'start' }))
        parts.push(`<path d="M ${fromX} ${y + 6} h ${loopW} v ${loopH} h -${loopW}" fill="none" stroke="${COLORS.edge}" stroke-width="1.4" marker-end="url(#ml-arrow)"/>`)
        y += rowH + 12
        continue
      }
      parts.push(svgText((fromX + toX) / 2, labelY, message.text, { size: 12 }))
      const dashed = message.dashed ? ' stroke-dasharray="6 4"' : ''
      const marker = message.lost ? '' : ' marker-end="url(#ml-arrow)"'
      parts.push(`<line x1="${fromX}" y1="${y + 10}" x2="${toX}" y2="${y + 10}" stroke="${COLORS.edge}" stroke-width="1.4"${dashed}${marker}/>`)
      if (message.lost) {
        parts.push(svgText(toX, y + 10, '×', { size: 16, fill: COLORS.edge }))
      }
      y += rowH
    }
    const bottom = y + 8

    const lifelines = []
    participants.forEach((participant, i) => {
      lifelines.push(`<rect x="${xs[i] - actorW[i] / 2}" y="${top}" width="${actorW[i]}" height="${actorH}" rx="8" fill="${COLORS.actorFill}" stroke="${COLORS.actorStroke}" stroke-width="1.5"/>`)
      lifelines.push(svgText(xs[i], top + actorH / 2, participant.label, { size: fontSize, weight: '600' }))
      lifelines.push(`<line x1="${xs[i]}" y1="${top + actorH}" x2="${xs[i]}" y2="${bottom}" stroke="${COLORS.line}" stroke-width="1.2" stroke-dasharray="5 4"/>`)
    })

    return svgDocument(width, bottom + 20, parts.join('') + lifelines.join(''))
  }

  // -------------------------------------------------------------------------
  // 甘特图

  const GANTT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

  function renderGantt (code) {
    let title = ''
    let dateFormat = ''
    let section = ''
    const tasks = []
    const byId = new Map()
    let started = false

    for (const rawLine of String(code || '').split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('%%')) continue
      if (/^gantt/i.test(line)) {
        started = true
        continue
      }
      if (!started) continue
      const titleMatch = line.match(/^title\s+(.+)$/i)
      if (titleMatch) {
        title = titleMatch[1].trim()
        continue
      }
      const formatMatch = line.match(/^dateFormat\s+(.+)$/i)
      if (formatMatch) {
        dateFormat = formatMatch[1].trim()
        continue
      }
      const sectionMatch = line.match(/^section\s+(.+)$/i)
      if (sectionMatch) {
        section = sectionMatch[1].trim()
        continue
      }
      if (/^(axisFormat|tickInterval|excludes|todayMarker|weekends)\b/i.test(line)) continue
      const taskMatch = line.match(/^(.+?)\s*:\s*(.+)$/)
      if (!taskMatch) continue
      const name = taskMatch[1].trim()
      const meta = taskMatch[2].split(',').map(part => part.trim()).filter(Boolean)
      const task = { name, section, status: '', id: '', start: '', durationDays: 0, milestone: false, afterId: '' }
      for (const token of meta) {
        if (/^(done|active|crit)$/i.test(token)) task.status = token.toLowerCase()
        else if (/^milestone$/i.test(token)) task.milestone = true
        else if (/^after\s+/i.test(token)) task.afterId = token.replace(/^after\s+/i, '').trim()
        else if (GANTT_DATE_RE.test(token)) task.start = token
        else {
          const duration = token.match(/^(\d+)\s*(d|day|days|w|week|weeks|h|hour|hours)$/i)
          if (duration) {
            const unit = duration[2].toLowerCase()
            task.durationDays = Number(duration[1]) * (unit.startsWith('w') ? 7 : unit.startsWith('h') ? 1 / 24 : 1)
          } else if (!task.id) {
            task.id = token
          }
        }
      }
      tasks.push(task)
      if (task.id) byId.set(task.id, task)
    }
    if (!tasks.length || (dateFormat && !/^y{4}[-/.]m{2}[-/.]d{2}$/i.test(dateFormat))) return null

    const DAY = 86400000
    const parseDay = value => new Date(`${value}T00:00:00Z`).getTime()
    const formatDay = time => new Date(time).toISOString().slice(5, 10)

    let minTime = Infinity
    for (const task of tasks) {
      if (task.start) minTime = Math.min(minTime, parseDay(task.start))
    }
    if (!Number.isFinite(minTime)) minTime = 0
    for (const task of tasks) {
      if (!task.start && task.afterId && byId.has(task.afterId)) {
        const parent = byId.get(task.afterId)
        if (parent.endTime !== undefined) task.startTime = parent.endTime
      }
      if (task.startTime === undefined) {
        task.startTime = task.start ? parseDay(task.start) : minTime
      }
      task.endTime = task.startTime + Math.max(task.durationDays, task.milestone ? 0 : 0.5) * DAY
      task.endTime = Math.max(task.endTime, task.startTime)
    }
    let maxTime = 0
    for (const task of tasks) {
      minTime = Math.min(minTime, task.startTime)
      maxTime = Math.max(maxTime, task.endTime)
    }

    const fontSize = 12
    const labelW = Math.max(80, Math.ceil(Math.max(...tasks.map(task => estimateTextWidth(task.name, fontSize))) + 16))
    const rowH = 30
    const sectionGap = 18
    const headerH = title ? 56 : 36
    const padX = 20
    const totalDays = Math.max((maxTime - minTime) / DAY, 1)
    const chartW = Math.max(totalDays * 30, 240)
    const width = padX * 2 + labelW + chartW

    const parts = []
    let y = 20
    if (title) {
      parts.push(svgText(width / 2, y + 10, title, { size: 15, weight: '600' }))
      y += 30
    }

    // 刻度步长保证日期标签间距不小于约 48px。
    let dayTick = 30
    for (const candidate of [1, 2, 3, 7, 14, 30]) {
      if ((chartW / totalDays) * candidate >= 48 || candidate === 30) {
        dayTick = candidate
        break
      }
    }
    for (let day = 0; day <= totalDays + 0.001; day += dayTick) {
      const x = padX + labelW + (day / totalDays) * chartW
      parts.push(`<line x1="${x}" y1="${y + 12}" x2="${x}" y2="${y + 12 + 8}" stroke="${COLORS.grid}" stroke-width="1"/>`)
      parts.push(svgText(x, y + 2, formatDay(minTime + day * DAY), { size: 10, fill: COLORS.muted }))
    }
    y += 22

    let lastSection = null
    tasks.forEach(task => {
      if (task.section !== lastSection) {
        y += lastSection === null ? 4 : sectionGap
        parts.push(svgText(padX, y + 10, task.section, { size: 12, weight: '600', anchor: 'start', fill: COLORS.muted }))
        lastSection = task.section
        y += 24
      }
      const rowY = y
      y += rowH
      const x1 = padX + labelW + ((task.startTime - minTime) / DAY / totalDays) * chartW
      const x2 = padX + labelW + ((task.endTime - minTime) / DAY / totalDays) * chartW
      parts.push(svgText(padX + 4, rowY + rowH / 2, task.name, { size: fontSize, anchor: 'start' }))
      if (task.milestone) {
        const cx = x1
        parts.push(`<polygon points="${cx},${rowY + rowH / 2 - 8} ${cx + 8},${rowY + rowH / 2} ${cx},${rowY + rowH / 2 + 8} ${cx - 8},${rowY + rowH / 2}" fill="${COLORS.active}"/>`)
      } else {
        const fill = task.status === 'done' ? COLORS.done : task.status === 'active' ? COLORS.active : task.status === 'crit' ? COLORS.crit : COLORS.task
        parts.push(`<rect x="${x1}" y="${rowY + 7}" width="${Math.max(x2 - x1, 4)}" height="${rowH - 14}" rx="5" fill="${fill}"/>`)
      }
    })

    const height = y + 24
    parts.push(`<line x1="${padX + labelW}" y1="${headerH - 14}" x2="${padX + labelW}" y2="${height - 20}" stroke="${COLORS.grid}" stroke-width="1"/>`)
    return svgDocument(width, height, parts.join(''))
  }

  return { renderFlowChart, renderStateDiagram, renderSequenceDiagram, renderGantt }
}

function firstDirective (code) {
  return (String(code || '').split('\n').find(line => line.trim() && !line.trim().startsWith('%%')) || '').trim()
}

function detectDiagramType (code) {
  const first = firstDirective(code)
  for (const key of Object.keys(DIAGRAM_LABELS)) {
    if (first === key || first.startsWith(`${key} `) || first.startsWith(`${key}\t`)) return DIAGRAM_LABELS[key]
  }
  return '图表'
}

// 返回 SVG 字符串；不支持的图或解析失败返回 null。
function renderMermaid (code, options = {}) {
  const first = firstDirective(code)
  const painter = createPainter(options.colors)
  try {
    if (/^(flowchart|graph)\b/i.test(first)) return painter.renderFlowChart(code)
    if (/^sequenceDiagram\b/i.test(first)) return painter.renderSequenceDiagram(code)
    if (/^stateDiagram(-v2)?\b/i.test(first)) return painter.renderStateDiagram(code)
    if (/^gantt\b/i.test(first)) return painter.renderGantt(code)
  } catch (_) {
    return null
  }
  return null
}

function mermaidSvgDataUri (svg) {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
  return `data:image/svg+xml;charset=utf-8,${encoded}`
}

module.exports = { DEFAULT_COLORS, DIAGRAM_LABELS, detectDiagramType, mermaidSvgDataUri, renderMermaid }
