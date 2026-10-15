'use strict'

const EVENT_NAME_ALIASES = {
  doubleclick: 'dblclick',
  change: 'change',
  input: 'input'
}

function dependencyChanged (previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) return true
  return next.some((value, index) => !Object.is(value, previous[index]))
}

function normalizeStyleName (name) {
  if (String(name).startsWith('--')) return String(name)
  return String(name).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).replace(/^ms-/, '-ms-')
}

function eventNameForProp (name) {
  const match = String(name).match(/^on([A-Z].*?)(?:Capture)?$/)
  if (!match) return ''
  const lower = match[1].toLowerCase()
  return EVENT_NAME_ALIASES[lower] || lower
}

function createReactCompatRuntime (options) {
  const { document, scheduleFlush, setTimeout: hostSetTimeout, reportError } = options
  const roots = new WeakMap()
  const typeIds = new WeakMap()
  let idCounter = 0
  const typeId = type => { if (!typeIds.has(type)) typeIds.set(type, ++idCounter); return typeIds.get(type) }

  function renderRoot (container, element, React) {
    if (!container || container.nodeType !== 1) return false
    let root = roots.get(container)
    if (!root) {
      root = { container, element, React, hooks: new Map(), nodes: new Map(), effects: [], pending: false, scheduled: false, rendering: false, passes: 0 }
      roots.set(container, root)
    }
    root.element = element
    root.React = React
    performRender(root)
    return true
  }

  function scheduleRender (root) {
    if (document._runtimeDisposed) return
    root.pending = true
    if (root.rendering || root.scheduled) return
    root.scheduled = true
    hostSetTimeout(() => {
      root.scheduled = false
      if (root.pending && !document._runtimeDisposed) performRender(root)
    }, 0)
  }

  function performRender (root) {
    if (root.rendering) { root.pending = true; return }
    root.rendering = true
    try {
      let pass = 0
      do {
        root.pending = false
        root.effects = []
        root.nextNodes = new Map()
        root.nextChildren = new Map([[root.container, []]])
        root.liveHooks = new Set()
        appendReactValue(root.container, root.element, root, '0')
        // Keep surviving node identities. Replacing the entire root restarts
        // images and collapses WXML scroll anchors for a one-label state update.
        for (const [parent, children] of root.nextChildren) {
          const keep = new Set(children)
          parent.childNodes.slice().forEach(child => { if (!keep.has(child)) parent.removeChild(child) })
          children.forEach((child, index) => { if (parent.childNodes[index] !== child) parent.insertBefore(child, parent.childNodes[index] || null) })
        }
        for (const [key, record] of root.nodes) {
          const next = root.nextNodes.get(key)
          if (!next || next.ref !== record.ref) assignRef(record.ref, null)
        }
        for (const [key, record] of root.nextNodes) {
          const old = root.nodes.get(key)
          if (!old || old.ref !== record.ref) assignRef(record.ref, record.node)
        }
        root.nodes = root.nextNodes
        for (const [key, slots] of root.hooks) if (!root.liveHooks.has(key)) {
          slots.forEach(slot => { if (typeof slot.cleanup === 'function') { try { slot.cleanup() } catch (error) { reportError(error, 'react:cleanup') } } })
          root.hooks.delete(key)
        }
        const effects = root.effects.splice(0)
        effects.forEach(effect => {
          try {
            if (typeof effect.previousCleanup === 'function') effect.previousCleanup()
            const cleanup = effect.callback()
            effect.slot.cleanup = typeof cleanup === 'function' ? cleanup : null
          } catch (error) { reportError(error, 'react:effect') }
        })
      } while (root.pending && ++pass < 8)
      root.passes += pass + 1
      scheduleFlush()
    } catch (error) {
      reportError(error, 'react:render')
    } finally {
      root.rendering = false
    }
  }

  function dispatcherFor (root, path) {
    root.liveHooks.add(path)
    const slots = root.hooks.get(path) || []
    root.hooks.set(path, slots)
    let index = 0
    const take = initializer => {
      const slotIndex = index++
      if (!slots[slotIndex]) slots[slotIndex] = initializer()
      return slots[slotIndex]
    }
    const useEffect = (callback, dependencies) => {
      const slot = take(() => ({ dependencies: undefined, cleanup: null }))
      if (dependencyChanged(slot.dependencies, dependencies)) {
        root.effects.push({ callback, previousCleanup: slot.cleanup, slot })
        slot.dependencies = Array.isArray(dependencies) ? dependencies.slice() : undefined
      }
    }
    return {
      useState (initial) {
        const slot = take(() => ({ value: typeof initial === 'function' ? initial() : initial }))
        return [slot.value, value => { const next = typeof value === 'function' ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; scheduleRender(root) } }]
      },
      useReducer (reducer, initialArg, init) {
        const slot = take(() => ({ value: typeof init === 'function' ? init(initialArg) : initialArg }))
        return [slot.value, action => { const next = reducer(slot.value, action); if (!Object.is(next, slot.value)) { slot.value = next; scheduleRender(root) } }]
      },
      useRef (initial) { return take(() => ({ current: initial })) },
      useMemo (factory, dependencies) {
        const slot = take(() => ({ initialized: false, dependencies: undefined, value: undefined }))
        if (!slot.initialized || dependencyChanged(slot.dependencies, dependencies)) { slot.value = factory(); slot.dependencies = Array.isArray(dependencies) ? dependencies.slice() : undefined; slot.initialized = true }
        return slot.value
      },
      useCallback (callback, dependencies) { return this.useMemo(() => callback, dependencies) },
      useEffect,
      useLayoutEffect: useEffect,
      useInsertionEffect: useEffect,
      useContext (context) { return context ? (context._currentValue !== undefined ? context._currentValue : context._currentValue2) : undefined },
      useImperativeHandle (ref, create, dependencies) { useEffect(() => { assignRef(ref, create()); return () => assignRef(ref, null) }, dependencies) },
      useDebugValue () {},
      useDeferredValue (value) { return value },
      useTransition () { return [false, callback => callback()] },
      useId () { return take(() => ({ value: `hr-${++idCounter}` })).value },
      useSyncExternalStore (subscribe, getSnapshot) {
        const state = this.useState(() => getSnapshot())[0]
        useEffect(() => typeof subscribe === 'function' ? subscribe(() => scheduleRender(root)) : undefined, [subscribe])
        return typeof getSnapshot === 'function' ? getSnapshot() : state
      },
      useMutableSource (_source, getSnapshot) { return getSnapshot(_source) }
    }
  }

  function withDispatcher (root, path, callback) {
    const internals = root.React && root.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
    const holder = internals && internals.ReactCurrentDispatcher
    const previous = holder && holder.current
    if (holder) holder.current = dispatcherFor(root, path)
    try { return callback() } finally { if (holder) holder.current = previous }
  }

  function appendReactValue (parent, value, root, path) {
    if (value == null || value === false || value === true) return
    if (Array.isArray(value)) { value.forEach((item, index) => appendReactValue(parent, item, root, `${path}.${item && item.key != null ? 'k' + JSON.stringify(String(item.key)) : index}`)); return }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
      const key = `${path}.text`, old = root.nodes.get(key)
      const node = old ? old.node : document.createTextNode(String(value))
      if (node.textContent !== String(value)) node.textContent = String(value)
      root.nextNodes.set(key, { node }); root.nextChildren.get(parent).push(node); return
    }
    if (typeof value !== 'object') return

    if (!('type' in value) && typeof value[Symbol.iterator] === 'function') {
      Array.from(value).forEach((item, index) => appendReactValue(parent, item, root, `${path}.${index}`))
      return
    }

    let type = value.type
    const props = value.props || {}
    if (value.key != null) path += '.key' + JSON.stringify(String(value.key))
    if (type === root.React.Fragment || type === root.React.StrictMode || typeof type === 'symbol') {
      appendReactValue(parent, props.children, root, `${path}.f`)
      return
    }

    if (typeof type === 'object' && type) {
      if (type._context) {
        const context = type._context
        const previous = context._currentValue
        if (Object.prototype.hasOwnProperty.call(props, 'value')) context._currentValue = props.value
        try {
          const child = typeof props.children === 'function' ? props.children(context._currentValue) : props.children
          appendReactValue(parent, child, root, `${path}.c`)
        } finally { context._currentValue = previous }
        return
      }
      if (typeof type.render === 'function') {
        path += `.type${typeId(type)}`
        const rendered = withDispatcher(root, path, () => type.render(props, value.ref || null))
        appendReactValue(parent, rendered, root, `${path}.r`)
        return
      }
      if (type.type) type = type.type
      else if (typeof type._init === 'function') type = type._init(type._payload)
    }

    if (typeof type === 'function') {
      path += `.type${typeId(type)}`
      let rendered
      if (type.prototype && typeof type.prototype.render === 'function') {
        const instance = new type(props)
        instance.props = props
        instance.state = instance.state || {}
        instance.setState = patch => { instance.state = { ...instance.state, ...(typeof patch === 'function' ? patch(instance.state, instance.props) : patch) }; scheduleRender(root) }
        rendered = instance.render()
      } else rendered = withDispatcher(root, path, () => type(props))
      appendReactValue(parent, rendered, root, `${path}.0`)
      return
    }

    if (typeof type !== 'string') return
    path += `.host:${type}`
    const old = root.nodes.get(path)
    const element = old ? old.node : document.createElement(type)
    const record = { node: element, props: old && old.props || {}, listeners: old && old.listeners || new Map(), ref: value.ref || props.ref }
    applyProps(element, props, root, record)
    record.props = { ...props, style: props.style && { ...props.style } }
    root.nextNodes.set(path, record)
    if (!(props.dangerouslySetInnerHTML && props.dangerouslySetInnerHTML.__html != null)) {
      root.nextChildren.set(element, [])
      appendReactValue(element, props.children, root, `${path}.e`)
    }
    root.nextChildren.get(parent).push(element)
  }

  function applyProps (element, props, root, record) {
    const previous = record.props
    new Set(Object.keys(previous).concat(Object.keys(props))).forEach(name => {
      if (name === 'children' || name === 'key' || name === 'ref' || name === 'suppressHydrationWarning' || name === 'suppressContentEditableWarning') return
      const value = props[name]
      if (name !== 'style' && Object.is(value, previous[name])) return
      if (name === 'dangerouslySetInnerHTML') { if (value && value.__html != null && String(value.__html) !== String(previous[name] && previous[name].__html)) element.innerHTML = String(value.__html); return }
      if (name === 'className') { element.className = value || ''; return }
      if (name === 'htmlFor') { element.setAttribute('for', value); return }
      if (name === 'style') {
        const styles = value && typeof value === 'object' ? value : {}, old = previous.style || {}
        new Set(Object.keys(old).concat(Object.keys(styles))).forEach(property => {
          if (Object.is(old[property], styles[property])) return
          let styleValue = styles[property]
          if (typeof styleValue === 'number' && styleValue !== 0 && !/^(?:opacity|zIndex|fontWeight|lineHeight|flex|order|zoom)$/.test(property)) styleValue = `${styleValue}px`
          element.style.setProperty(normalizeStyleName(property), styleValue == null ? '' : String(styleValue))
        })
        return
      }
      const eventName = eventNameForProp(name)
      if (eventName) {
        const capture = /Capture$/.test(name), old = record.listeners.get(name)
        if (old) { element.removeEventListener(eventName, old, capture); record.listeners.delete(name) }
        if (typeof value !== 'function') return
        const listener = event => {
          try { value(event) } catch (error) { reportError(error, `react:event:${eventName}`) }
          if (root.pending) performRender(root)
        }
        record.listeners.set(name, listener); element.addEventListener(eventName, listener, capture)
        return
      }
      if (name === 'value' || name === 'checked' || name === 'selected' || name === 'disabled' || name === 'readOnly' || name === 'multiple') {
        element[name] = value
        return
      }
      if (value === false || value == null) { element.removeAttribute(name); return }
      element.setAttribute(name, value === true ? '' : String(value))
    })
  }

  function assignRef (ref, value) {
    if (typeof ref === 'function') ref(value)
    else if (ref && typeof ref === 'object') ref.current = value
  }

  return { renderRoot }
}

module.exports = { createReactCompatRuntime }
