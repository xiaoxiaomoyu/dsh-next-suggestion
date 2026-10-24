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
.dsh-ns-gear{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#aaa);cursor:pointer;width:28px;height:28px;border-radius:7px;display:grid;place-items:center;font-size:14px;line-height:1;padding:0}
.dsh-ns-gear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee)}
.dsh-ns-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.5);display:grid;place-items:center;padding:24px;animation:dsh-ns-fade 140ms ease-out}
.dsh-ns-panel:focus{outline:none}
.dsh-ns-panel{box-sizing:border-box;width:min(460px,100%);animation:dsh-ns-pop 180ms ease-out;max-height:min(720px,86vh);overflow:auto;padding:18px 20px 16px;border-radius:16px;background:var(--dsw-specific-input-major,#1e1e1e);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));box-shadow:0 24px 60px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#eee);font-size:13px;line-height:20px}
.dsh-ns-panelhead{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:15px;margin-bottom:6px}
.dsh-ns-sect{margin:16px 0 6px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));color:var(--dsw-alias-label-caption,#888);font-size:11px;letter-spacing:.06em}
.dsh-ns-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:32px;padding:2px 0}
.dsh-ns-row>span{flex:1;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-ns-num{width:76px;box-sizing:border-box;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:6px;padding:3px 6px;font:inherit}
.dsh-ns-text{width:190px;box-sizing:border-box;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:6px;padding:3px 8px;font:inherit}
.dsh-ns-check{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-ns-seg{display:flex;gap:6px}
.dsh-ns-seg button{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:inherit;border-radius:6px;padding:2px 12px;font:inherit;cursor:pointer}
.dsh-ns-seg button[data-on=true]{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:#fff}
.dsh-ns-hint{color:var(--dsw-alias-label-caption,#888);font-size:11px;padding:2px 0 6px}
.dsh-ns-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}
.dsh-ns-footer .dsh-ns-hint{padding:0;margin:0}
.dsh-ns-adv{margin-top:14px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))}
.dsh-ns-adv summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#bbb);font-size:12px;font-weight:500}
@keyframes dsh-ns-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-ns-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.dsh-ns-backdrop,.dsh-ns-panel{animation:none}}
.dsh-ns-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:transparent;color:inherit;border-radius:7px;padding:3px 10px;font:inherit;cursor:pointer}
.dsh-ns-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
`

    // Device-local preferences. Everything the settings panel edits lives here;
    // the Host accepts per-request overrides, so nothing here needs a restart.
    const PREFS_KEY = 'dsh-next-suggestion:prefs'
    const DEFAULT_PREFS = {
      enabled: true,
      count: 3,
      tab: true,
      arrow: true,
      esc: true,
      backoff: true,
      backoffAfter: 5,
      backoffEvery: 3,
      onlyQuestion: false,
      defaultCollapsed: false,
      showCount: true,
      onlyThisSession: false,
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      maxMessages: 12,
      messageChars: 1200,
      timeoutMs: 15000,
      maxOutputTokens: 4000,
    }
    const PREFS = (() => {
      try {
        const raw = window.localStorage.getItem(PREFS_KEY)
        const value = raw ? JSON.parse(raw) : {}
        return { ...DEFAULT_PREFS, ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}) }
      } catch {
        return { ...DEFAULT_PREFS }
      }
    })()
    const prefsListeners = new Set()
    const persistPrefs = () => {
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(PREFS))
      } catch {
        // storage is a convenience only
      }
    }
    const updatePrefs = (patch) => {
      Object.assign(PREFS, patch)
      persistPrefs()
      for (const listener of prefsListeners) listener()
    }
    const resetPrefs = () => {
      Object.assign(PREFS, DEFAULT_PREFS)
      persistPrefs()
      for (const listener of prefsListeners) listener()
    }
    const usePrefs = () => {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => force((value) => value + 1)
        prefsListeners.add(listener)
        return () => prefsListeners.delete(listener)
      }, [])
      return PREFS
    }

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

    // Sessions the user muted from the settings panel, for this tab only.
    const MUTED_KEY = 'dsh-next-suggestion:muted'
    const MUTED = (() => {
      try {
        const raw = window.sessionStorage.getItem(MUTED_KEY)
        const list = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [])
      } catch {
        return new Set()
      }
    })()
    const persistMuted = () => {
      try {
        window.sessionStorage.setItem(MUTED_KEY, JSON.stringify([...MUTED]))
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
      const prefs = usePrefs()

      const sessionId = session && session.sessionId ? String(session.sessionId) : ''
      const running = Boolean(session && session.running)
      const draft = input && typeof input.draft === 'string' ? input.draft : ''
      const phase = input && typeof input.phase === 'string' ? input.phase : 'plain'

      const [items, setItems] = React.useState([])
      const [cfg, setCfg] = React.useState({ enabled: true, count: 3, debug: false })
      const [collapsed, setCollapsed] = React.useState(() =>
        sessionId ? COLLAPSED[sessionId] === true : prefs.defaultCollapsed,
      )
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
        if (!prefs.enabled) reason = 'prefs-disabled'
        else if (!snap.sessionId) reason = 'no-session'
        else if (MUTED.has(snap.sessionId)) reason = 'muted'
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
        // After repeated ignoring, only try every Nth turn.
        if (
          !fresh &&
          prefs.backoff &&
          stats.current.ignored >= Math.max(1, prefs.backoffAfter) &&
          stats.current.turn % Math.max(1, prefs.backoffEvery) !== 0
        ) {
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
            body: JSON.stringify({
              sessionId: sid,
              fresh,
              count: prefs.count,
              provider: prefs.provider,
              model: prefs.model,
              maxMessages: prefs.maxMessages,
              messageChars: prefs.messageChars,
              timeoutMs: prefs.timeoutMs,
              maxOutputTokens: prefs.maxOutputTokens,
              onlyQuestion: prefs.onlyQuestion,
              avoid: fresh ? itemsRef.current.slice(0, 5) : [],
            }),
            signal: ctrl.signal,
          })
          if (!res.ok) return
          const data = await res.json()
          if (ctrl.signal.aborted) return
          if (latest.current.running) return
          if (latest.current.draft !== '' || latest.current.sessionId !== sid) return
          const limit = Math.max(1, Number(prefs.count) || 3)
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
          } else if (fresh) {
            // An explicit "try again" that produced nothing should not leave
            // the previous batch on screen as if it were the new answer.
            setItems([])
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
        setCollapsed(COLLAPSED[sessionId] === undefined ? prefs.defaultCollapsed : COLLAPSED[sessionId] === true)
        if (MUTED.has(sessionId) || DISMISSED.has(sessionId)) {
          beacon({ event: 'muted-or-dismissed', sid: sessionId.slice(0, 12) })
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

      React.useEffect(() => {
        const onMuted = (event) => {
          if (event.detail !== latest.current.sessionId) return
          cancel()
          setItems([])
        }
        window.addEventListener('dsh-next-suggestion:muted', onMuted)
        return () => window.removeEventListener('dsh-next-suggestion:muted', onMuted)
      }, [cancel])

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
            if (!prefs.tab) return
            event.preventDefault()
            fill(items[0])
          } else if (event.key === 'ArrowRight') {
            if (!prefs.arrow) return
            if (latest.current.draft !== '') return
            event.preventDefault()
            fill(items[0])
          } else if (event.key === 'Escape') {
            if (!prefs.esc) return
            event.preventDefault()
            dismiss()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [items, sessionId])

      if (!prefs.enabled || !cfg.enabled || items.length === 0) return null

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
            prefs.showCount && items.length > 1 ? h('span', { className: 'dsh-ns-count' }, `${items.length}`) : null,
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

    /** Gear in the composer toolbar; independent of whichever card mode is on. */
    function SettingsEntry(props) {
      const prefs = usePrefs()
      const session = props.session
      const sessionId = session && session.sessionId ? String(session.sessionId) : ''
      const [open, setOpen] = React.useState(false)
      const btnRef = React.useRef(null)
      const panelRef = React.useRef(null)

      React.useEffect(() => {
        if (!open) return
        const panel = panelRef.current
        if (!panel) return
        const selector = 'button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'
        const focusables = () =>
          Array.from(panel.querySelectorAll(selector)).filter((element) => !element.disabled && element.offsetParent !== null)
        panel.focus()
        const onKey = (event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            return
          }
          if (event.key !== 'Tab') return
          const list = focusables()
          if (list.length === 0) return
          const index = list.indexOf(document.activeElement)
          const next = event.shiftKey
            ? list[index <= 0 ? list.length - 1 : index - 1]
            : list[index === -1 || index === list.length - 1 ? 0 : index + 1]
          event.preventDefault()
          next.focus()
        }
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          if (btnRef.current) btnRef.current.focus()
        }
      }, [open])

      const muted = sessionId !== '' && MUTED.has(sessionId)
      const mute = () => {
        if (!sessionId) return
        if (muted) MUTED.delete(sessionId)
        else MUTED.add(sessionId)
        persistMuted()
        window.dispatchEvent(new CustomEvent('dsh-next-suggestion:muted', { detail: sessionId }))
      }

      const row = (label, control) =>
        h('div', { className: 'dsh-ns-row' }, h('span', null, label), control)
      const check = (key, label) =>
        h(
          'label',
          { className: 'dsh-ns-check' },
          h('input', { type: 'checkbox', checked: Boolean(prefs[key]), onChange: (e) => updatePrefs({ [key]: e.target.checked }) }),
          h('span', null, label),
        )
      const num = (key, min, max) =>
        h('input', {
          type: 'number',
          className: 'dsh-ns-num',
          value: prefs[key],
          min,
          max,
          onChange: (e) => {
            const value = Number(e.target.value)
            if (Number.isFinite(value)) updatePrefs({ [key]: Math.min(max, Math.max(min, Math.trunc(value))) })
          },
        })
      const text = (key, placeholder) =>
        h('input', {
          type: 'text',
          className: 'dsh-ns-text',
          value: prefs[key],
          placeholder,
          onChange: (e) => updatePrefs({ [key]: e.target.value }),
        })
      const seg = (key, options) =>
        h(
          'div',
          { className: 'dsh-ns-seg' },
          options.map((option) =>
            h(
              'button',
              {
                key: String(option.value),
                type: 'button',
                'data-on': prefs[key] === option.value ? 'true' : 'false',
                onClick: () => updatePrefs({ [key]: option.value }),
              },
              option.label,
            ),
          ),
        )

      const body = open
        ? h(
            'div',
            {
              className: 'dsh-ns-backdrop',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) setOpen(false)
              },
            },
            h(
              'div',
              {
                ref: panelRef,
                className: 'dsh-ns-panel',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'dsh-ns-title',
                tabIndex: -1,
              },
              h(
                'div',
                { className: 'dsh-ns-panelhead' },
                h('span', { id: 'dsh-ns-title' }, '下一句设置'),
                h(
                  'button',
                  { type: 'button', className: 'dsh-ns-icon', 'aria-label': '关闭', onClick: () => setOpen(false) },
                  '×',
                ),
              ),
              row('启用建议', check('enabled', '显示')),
              row(
                '候选条数',
                seg('count', [
                  { value: 1, label: '1' },
                  { value: 2, label: '2' },
                  { value: 3, label: '3' },
                ]),
            ),
            h('div', { className: 'dsh-ns-sect' }, '接受方式'),
            row('Tab', check('tab', '接受第一条')),
            row('→', check('arrow', '空输入框时接受')),
            row('Esc', check('esc', '收起卡片')),
            h('div', { className: 'dsh-ns-sect' }, '触发'),
            row(
              '时机',
              seg('onlyQuestion', [
                { value: false, label: '每轮' },
                { value: true, label: '仅问句' },
              ]),
            ),
            row('默认收起', check('defaultCollapsed', '只显示一条')),
            row('条数角标', check('showCount', '显示')),
            h('div', { className: 'dsh-ns-sect' }, '降频'),
            row('启用降频', check('backoff', '减少出现')),
            row('连续忽略', num('backoffAfter', 1, 20)),
            row('每几轮出现', num('backoffEvery', 2, 10)),
            row(
              '本会话',
              h(
                'button',
                { type: 'button', className: 'dsh-ns-btn', onClick: mute, disabled: !sessionId },
                muted ? '恢复提示' : '不再提示',
              ),
            ),
            h(
              'div',
              { className: 'dsh-ns-footer' },
              h('span', { className: 'dsh-ns-hint' }, '设置只保存在本机浏览器，换设备不同步。'),
              h(
                'button',
                { type: 'button', className: 'dsh-ns-btn', onClick: () => resetPrefs() },
                '恢复默认',
              ),
            ),
            h(
              'details',
              { className: 'dsh-ns-adv' },
              h('summary', null, '高级'),
              h('div', { className: 'dsh-ns-hint' }, '改错会导致预测失败；默认值一般够用。'),
              row('provider', text('provider', 'deepseek-official')),
              row('model', text('model', 'deepseek-flash')),
              row('上下文条数', num('maxMessages', 2, 20)),
              row('每条字符数', num('messageChars', 100, 2000)),
              row('超时 (ms)', num('timeoutMs', 1000, 60000)),
              row('最大输出 token', num('maxOutputTokens', 200, 16000)),
            ),
          ),
        )
        : null

      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        h(
          'button',
          {
            ref: btnRef,
            type: 'button',
            className: 'dsh-ns-gear',
            'aria-label': '下一句设置',
            title: '下一句设置',
            'aria-expanded': open ? 'true' : 'false',
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => setOpen((value) => !value),
          },
          h(
            'svg',
            { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' },
            h('path', {
              d: 'M3 6h7M15 6h2M3 14h2M9 14h8',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': 1.5,
              'stroke-linecap': 'round',
            }),
            h('circle', { cx: 13, cy: 6, r: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
            h('circle', { cx: 7, cy: 14, r: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
          ),
        ),
        body,
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
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'next-suggestion-settings',
              order: 5,
            },
            SettingsEntry,
          ),
        )
      },
    }
  },
})
