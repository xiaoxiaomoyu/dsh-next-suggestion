/**
 * Browser half of dsh-next-suggestion.
 *
 * Registers one entry in `conversation.input.dock` — the row above the composer
 * card. It watches the Session turn state, asks the Host for candidates when a
 * turn ends, and fills the composer through the public InputActions face.
 *
 * The composer itself is never modified: no DOM writes, no key interception.
 */
window.__ModuleLoader__.load({
  id: 'dsh-next-suggestion',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const BASE = '/plugins/dsh-next-suggestion'
    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')
    const TEXT = {
      label: ZH ? '下一句' : 'Next message',
      close: ZH ? '关闭' : 'Close',
      collapse: ZH ? '收起' : 'Collapse',
      expand: ZH ? '展开' : 'Expand',
      refresh: ZH ? '换一批' : 'Try again',
    }

    const CSS = `
.dsh-ns-card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,760px);margin:0 auto 8px;padding:4px;border-radius:var(--dsw-radius-panel,16px);background:var(--dsw-specific-input-major,#242424);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));box-shadow:var(--dsw-elevation-soft,none);color:var(--dsw-alias-label-primary,#eee);font-size:13px;line-height:20px;display:flex;flex-direction:column;gap:2px}
.dsh-ns-head{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 2px 8px;color:var(--dsw-alias-label-caption,#888);font-size:11px;line-height:16px}
.dsh-ns-icon{appearance:none;border:0;background:transparent;color:inherit;cursor:pointer;width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:14px;line-height:1;padding:0}
.dsh-ns-icon:disabled{opacity:.45;cursor:default}
.dsh-ns-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee)}
.dsh-ns-item{appearance:none;border:0;background:transparent;color:inherit;text-align:left;font:inherit;padding:6px 8px;border-radius:8px;cursor:pointer;white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;width:100%}
.dsh-ns-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dsh-ns-title{display:flex;align-items:center;gap:6px}
.dsh-ns-count{font:inherit;font-size:10px;line-height:14px;padding:0 4px;border:1px solid currentColor;border-radius:8px;opacity:.8}
.dsh-ns-actions{display:flex;align-items:center;gap:2px}
.dsh-ns-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px}
`

    // Per-Session cache: remounting the composer (session switch) restores the
    // last card instantly instead of paying for another model call.
    const CACHE = new Map()
    const CACHE_TTL_MS = 120000
    const CACHE_LIMIT = 20

    // A closed card stays closed for the rest of that turn, including a page
    // refresh, until the next turn starts.
    const DISMISSED_KEY = 'dsh-next-suggestion:dismissed'
    const DISMISSED = (() => {
      try {
        const raw = window.sessionStorage.getItem(DISMISSED_KEY)
        const list = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [])
      } catch {
        return new Set()
      }
    })()
    const persistDismissed = () => {
      while (DISMISSED.size > 20) DISMISSED.delete(DISMISSED.values().next().value)
      try {
        window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...DISMISSED]))
      } catch {
        // session storage is best-effort
      }
    }

    // Collapsed state is per Session, remembered across reloads.
    const COLLAPSE_KEY = 'dsh-next-suggestion:collapsed'
    const COLLAPSED = (() => {
      try {
        const raw = window.localStorage.getItem(COLLAPSE_KEY)
        const value = raw ? JSON.parse(raw) : {}
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      } catch {
        return {}
      }
    })()
    const persistCollapsed = () => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(COLLAPSED))
      } catch {
        // storage is a convenience only
      }
    }

    /**
     * @param {{
     *   session?: { sessionId?: string, running?: boolean },
     *   input?: { draft?: string, phase?: string, attachmentIds?: unknown[], queue?: unknown[] },
     *   inputActions?: { captureInsertion?: Function, insertText?: Function },
     * }} props
     */
    function SuggestionCard(props) {
      const session = props.session
      const input = props.input
      const actions = props.inputActions

      const sessionId = session && session.sessionId ? String(session.sessionId) : ''
      const running = Boolean(session && session.running)
      const draft = input && typeof input.draft === 'string' ? input.draft : ''
      const phase = input && typeof input.phase === 'string' ? input.phase : 'plain'

      const [items, setItems] = React.useState([])
      const [cfg, setCfg] = React.useState({ enabled: true, count: 3, debug: false })
      const [collapsed, setCollapsed] = React.useState(() => (sessionId ? COLLAPSED[sessionId] === true : false))
      const [busy, setBusy] = React.useState(false)
      const rootRef = React.useRef(null)

      const toggleCollapsed = () => {
        setCollapsed((value) => {
          const next = !value
          if (sessionId) {
            COLLAPSED[sessionId] = next
            persistCollapsed()
          }
          return next
        })
      }

      const latest = React.useRef({ draft, phase, sessionId, running, input })
      latest.current = { draft, phase, sessionId, running, input }

      const cfgRef = React.useRef(cfg)
      cfgRef.current = cfg

      const runRef = React.useRef({ timer: 0, ctrl: null })
      const stats = React.useRef({ ignored: 0, turn: 0, used: false })
      const itemsRef = React.useRef([])
      itemsRef.current = items

      const cancel = React.useCallback(() => {
        if (runRef.current.timer) {
          clearTimeout(runRef.current.timer)
          runRef.current.timer = 0
        }
        if (runRef.current.ctrl) {
          try {
            runRef.current.ctrl.abort()
          } catch {}
          runRef.current.ctrl = null
        }
      }, [])

      const beacon = React.useCallback((payload) => {
        if (!cfgRef.current.debug) return
        try {
          fetch(`${BASE}/debug`, {
            method: 'POST',
            keepalive: true,
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch(() => {})
        } catch {
          // diagnostics only
        }
      }, [])

      // Client-visible configuration.
      React.useEffect(() => {
        let alive = true
        fetch(`${BASE}/config`, { credentials: 'same-origin' })
          .then((res) => (res.ok ? res.json() : null))
          .then((value) => {
            if (!alive || value === null || typeof value !== 'object') return
            const next = {
              enabled: value.enabled !== false,
              count: Number(value.count) || 3,
              debug: value.debug === true,
            }
            cfgRef.current = next
            setCfg(next)
            if (next.debug) {
              beacon({
                event: 'mount',
                running: latest.current.running,
                sid: String(latest.current.sessionId || '').slice(0, 12),
                hasInput: Boolean(latest.current.input),
              })
            }
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [beacon])

      const predict = React.useCallback(async (fresh = false) => {
        const snap = latest.current
        const attachments = snap.input && snap.input.attachmentIds ? snap.input.attachmentIds.length : 0
        const queued = snap.input && snap.input.queue ? snap.input.queue.length : 0
        let reason = ''
        if (!snap.sessionId) reason = 'no-session'
        else if (snap.running) reason = 'running'
        else if (!cfgRef.current.enabled) reason = 'disabled'
        else if (snap.draft !== '') reason = 'draft'
        else if (snap.phase !== 'plain') reason = `phase:${snap.phase}`
        else if (attachments > 0) reason = 'attachments'
        else if (queued > 0) reason = 'queued'
        if (reason !== '') {
          beacon({ event: 'skip', reason, draftLen: snap.draft.length })
          return
        }
        // After repeated ignoring, only try every third turn.
        if (!fresh && stats.current.ignored >= 5 && stats.current.turn % 3 !== 0) {
          beacon({ event: 'skip', reason: 'backoff', ignored: stats.current.ignored })
          return
        }

        const sid = snap.sessionId
        const ctrl = new AbortController()
        runRef.current.ctrl = ctrl
        setBusy(true)
        try {
          const res = await fetch(`${BASE}/predict`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sid, fresh }),
            signal: ctrl.signal,
          })
          if (!res.ok) return
          const data = await res.json()
          if (ctrl.signal.aborted) return
          if (latest.current.running) return
          if (latest.current.draft !== '' || latest.current.sessionId !== sid) return
          const limit = Math.max(1, Number(cfgRef.current.count) || 3)
          const list = Array.isArray(data.items)
            ? data.items
                .filter(
                  (item) =>
                    typeof item === 'string' &&
                    item.trim() !== '' &&
                    !/^[\[{]/.test(item.trim()) &&
                    !item.includes('","'),
                )
                .slice(0, limit)
            : []
          beacon({ event: 'result', count: list.length, raw: Array.isArray(data.items) ? data.items.length : -1 })
          if (list.length > 0) {
            CACHE.set(sid, { items: list, at: Date.now() })
            while (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value)
            setItems(list)
          }
        } catch {
          if (!ctrl.signal.aborted) beacon({ event: 'error', reason: 'fetch' })
          // silent: a missing suggestion is not an error the user must see
        } finally {
          if (runRef.current.ctrl === ctrl) runRef.current.ctrl = null
          setBusy(false)
        }
      }, [beacon])

      // Turn end: running true -> false.
      const previousRunning = React.useRef(running)
      React.useEffect(() => {
        beacon({
          event: 'running',
          value: running,
          sid: String(latest.current.sessionId || '').slice(0, 12),
          draftLen: latest.current.draft.length,
        })
        const was = previousRunning.current
        previousRunning.current = running
        if (running) {
          const hadItems = itemsRef.current.length > 0
          if (hadItems && !stats.current.used) stats.current.ignored += 1
          else if (stats.current.used) stats.current.ignored = 0
          stats.current.used = false
          stats.current.turn += 1
          cancel()
          setItems([])
          if (latest.current.sessionId) {
            CACHE.delete(latest.current.sessionId)
            DISMISSED.delete(latest.current.sessionId)
            persistDismissed()
          }
          return
        }
        if (!was) return
        cancel()
        runRef.current.timer = setTimeout(() => {
          runRef.current.timer = 0
          void predict()
        }, 250)
      }, [running, cancel, predict, beacon])

      // Typing invalidates the prediction; so does any programmatic fill.
      React.useEffect(() => {
        if (draft === '') return
        cancel()
        setItems([])
        const sid = latest.current.sessionId
        if (sid) CACHE.delete(sid)
      }, [draft, cancel])

      // Session mount or switch: restore the cached card, otherwise ask once for
      // the latest completed turn, so a refresh does not lose the suggestion.
      React.useEffect(() => {
        if (!sessionId) return
        cancel()
        setItems([])
        setCollapsed(COLLAPSED[sessionId] === true)
        if (DISMISSED.has(sessionId)) {
          beacon({ event: 'dismissed', sid: sessionId.slice(0, 12) })
          return
        }
        if (latest.current.running) return
        // A card never sits on top of a draft the user already started.
        if (latest.current.draft !== '') {
          CACHE.delete(sessionId)
          return
        }
        const cached = CACHE.get(sessionId)
        if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.items.length > 0) {
          const limit = Math.max(1, Number(cfgRef.current.count) || 3)
          setItems(cached.items.slice(0, limit))
          beacon({ event: 'cache-hit', count: cached.items.length })
          return
        }
        runRef.current.timer = setTimeout(() => {
          runRef.current.timer = 0
          void predict()
        }, 300)
      }, [sessionId, cancel, predict, beacon])

      React.useEffect(() => cancel, [cancel])

      const fill = (text) => {
        if (!actions || latest.current.draft !== '') return
        try {
          const span = actions.captureInsertion()
          if (!span || span.start !== 0 || span.end !== 0) return
          const applied = actions.insertText(text, span)
          if (applied === false) return
          stats.current.used = true
          stats.current.ignored = 0
          setItems([])
          if (latest.current.sessionId) CACHE.delete(latest.current.sessionId)
          const root = rootRef.current
          const stack = root && root.parentElement
          const editor = stack ? stack.querySelector('[contenteditable="true"]') : null
          if (editor && typeof editor.focus === 'function') editor.focus()
        } catch {
          // revision guard refused the edit; keep the card usable
        }
      }

      const dismiss = () => {
        setItems([])
        cancel()
        stats.current.ignored += 1
        stats.current.used = false
        if (sessionId) {
          DISMISSED.add(sessionId)
          persistDismissed()
          CACHE.delete(sessionId)
        }
      }

      const refresh = () => {
        if (busy) return
        if (sessionId) CACHE.delete(sessionId)
        void predict(true)
      }

      // Claude-style acceptance: Tab or Right on an empty composer, Escape to
      // dismiss. Only while the card is visible and the editor owns focus, so
      // Tab still works as focus traversal everywhere else.
      React.useEffect(() => {
        if (items.length === 0) return
        const onKeyDown = (event) => {
          if (event.defaultPrevented || event.isComposing) return
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
          const root = rootRef.current
          const stack = root && root.parentElement
          const editor = stack ? stack.querySelector('[contenteditable="true"]') : null
          const active = document.activeElement
          if (!editor || !(active === editor || (active && editor.contains(active)))) return
          if (event.key === 'Tab') {
            event.preventDefault()
            fill(items[0])
          } else if (event.key === 'ArrowRight') {
            if (latest.current.draft !== '') return
            event.preventDefault()
            fill(items[0])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            dismiss()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [items, sessionId])

      if (!cfg.enabled || items.length === 0) return null

      const visible = collapsed ? items.slice(0, 1) : items
      const rows = visible.map((text, index) =>
        h(
          'button',
          {
            key: `${index}:${text}`,
            type: 'button',
            className: 'dsh-ns-item',
            title: text,
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => fill(text),
          },
          text,
        ),
      )

      return h(
        'div',
        { ref: rootRef, className: 'dsh-ns-card', role: 'group', 'aria-label': TEXT.label },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dsh-ns-head' },
          h(
            'span',
            { className: 'dsh-ns-title' },
            TEXT.label,
            items.length > 1 ? h('span', { className: 'dsh-ns-count' }, `${items.length}`) : null,
          ),
          h(
            'span',
            { className: 'dsh-ns-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-ns-icon',
                'aria-label': TEXT.refresh,
                title: TEXT.refresh,
                disabled: busy,
                onMouseDown: (event) => event.preventDefault(),
                onClick: () => refresh(),
              },
              busy ? '…' : '↻',
            ),
            items.length > 1
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-ns-icon',
                    'aria-label': collapsed ? TEXT.expand : TEXT.collapse,
                    'aria-expanded': collapsed ? 'false' : 'true',
                    title: collapsed ? TEXT.expand : TEXT.collapse,
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => toggleCollapsed(),
                  },
                  collapsed ? '▸' : '▾',
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-ns-icon',
                'aria-label': TEXT.close,
                title: TEXT.close,
                onMouseDown: (event) => event.preventDefault(),
                onClick: () => dismiss(),
              },
              '×',
            ),
          ),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, rows),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'next-suggestion',
              order: 10,
            },
            SuggestionCard,
          ),
        )
      },
    }
  },
})
