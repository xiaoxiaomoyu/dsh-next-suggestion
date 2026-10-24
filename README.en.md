# dsh-next-suggestion

> 中文：[README.md](README.md)

Predicts what you are about to say in DeepSeek Harness and offers a few candidates above the composer. Click one to put it in the input box; edit it or send it as usual.

```
┌ Next message ─────────────────────── 3 ─ ▾ ┐
│ Change count to 3, then try one round      │
│ The config is hot, no restart needed       │
│ Skip the model for now, check the three    │
└────────────────────────────────────────────┘
```

## Features

- Runs after every turn, and when you return to an idle session.
- Reads the current session only: the last 12 messages plus the opening task line.
- Gives 1–3 full-sentence candidates, ordered by likelihood, in the language of the conversation.
- Accept with a click, `Tab`, or `→`; the text goes in through the public `InputActions` face, so undo keeps working.
- Collapse to the top candidate, or close the card for the rest of that turn.
- `↻` asks again with a higher temperature when none of the candidates fit.
- Backs off by itself: after five discarded suggestions in a row it only tries every third turn.
- Never sends anything by itself, never rewrites text you already typed.
- Silent on failure: a slow or failed prediction just means no card.

## Requirements

- A DeepSeek Harness profile running the Web UI (`dsh web`).
- A configured model provider. The default call uses the `deepseek-official` route with `deepseek-flash`.
- Tested against DSH `0.2.1-rc.2`.

## Install

From a checkout:

```powershell
git clone https://github.com/xiaoxiaomoyu/dsh-next-suggestion.git
dsh plugin --profile web add "link:/absolute/path/to/dsh-next-suggestion"
```

Restart the host once after installing, then reload the page.

Uninstall:

```powershell
dsh plugin --profile web remove dsh-next-suggestion
```

Then remove the entry from `dsh.profile.bundles` if your DSH version leaves it behind, and restart.

## Usage

After the assistant finishes a turn, the card appears above the composer:

- **Click a row** — the sentence goes into the input box; the caret lands at the end. Nothing is sent.
- **Tab / →** — accept the top candidate while the composer is focused and empty. `→` only acts on an empty composer, where it has nothing else to do.
- **Esc** — dismiss the card.
- **▾ / ▸** — collapse to the most likely candidate or expand again. The choice is remembered per session in `localStorage`.
- **↻** — ask again with a higher temperature. One extra model call.
- **×** — hide the card for this turn. It stays hidden across session switches and page reloads until the next turn starts.

The card only appears when the composer is empty, there are no attachments or queued messages, and the session is not running.

## Settings

A sliders icon sits in the composer toolbar next to the send action; it opens every setting. Preferences are stored in this browser, take effect immediately, and do not sync across devices.

- Master switch and candidate count (1–3)
- Accept keys: Tab, →, and Esc, each independently toggleable
- Trigger: every turn, or only when the assistant's last message ends with a question
- Default collapsed state and the count badge
- Backoff: after N ignored suggestions, try once every M turns
- Mute this session
- Advanced: provider, model, context messages, characters per message, timeout, max output tokens
- **Restore defaults** resets keys, behavior, and advanced values in one click

Only the card layout exists today; an inline ghost mode (Codex style) is planned.

## Configuration

Edit the profile patch (`~/.dsh/profiles/<profile>/cordis.patch.yml`). A matching entry replaces the whole `config` object, so list every key you want to change:

```yaml
- id: dsh-next-suggestion
  name: dsh-next-suggestion
  config:
    enabled: true          # master switch
    count: 3               # 1-3 candidates
    provider: deepseek-official
    model: deepseek-flash
    maxMessages: 12        # transcript window
    messageChars: 1200     # per-message clip
    timeoutMs: 15000
    maxOutputTokens: 4000  # cap only; generation stops at the end of the JSON
    debug: false           # write $DSH_HOME/dsh-next-suggestion/debug.log
```

Config changes are hot-applied. JavaScript changes are not: restart the host after editing `index.js` or `client.js` (a page reload covers the client half).

`maxOutputTokens` is a ceiling, not a budget: a shorter answer stops early, so a larger cap does not make every turn slower or more expensive.

## How it works

**Client** — registers one entry in `conversation.input.dock` (`order: 10`). It watches `session.running`, waits 250 ms after a turn ends, then calls the Host. Results are cached in memory per session for two minutes, so switching back to a session does not spend another call. Typing, sending, or switching sessions cancels the request and clears the card.

**Host** — three loopback-only routes:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/plugins/dsh-next-suggestion/config` | `{ enabled, count, debug }` |
| `POST` | `/plugins/dsh-next-suggestion/predict` | body `{ sessionId }` → `{ items: string[] }` |
| `POST` | `/plugins/dsh-next-suggestion/debug` | client beacon, only when `debug: true` |

`predict` reads `session.deriveMessages()`, keeps the last 12 user/assistant text messages (assistant messages keep their opening 350 and closing 1200 characters, because conclusions and questions live at the end), prepends the first user message as task context, and asks the model for a JSON array. The parser tolerates code fences, a truncated array, and line lists; it drops candidates that repeat the user's recent messages, and never returns serialization leftovers such as `["..."]`.

Requests are bounded by `timeoutMs` and aborted when the browser disconnects.

## Privacy and cost

- Only the current session's text is read. Attachments, files, other sessions, and workspace contents are not.
- That transcript excerpt is sent to the provider configured for `provider`/`model`, under the same account and quota as the chat itself.
- The routes are registered outside the `/api` auth fence, so they reject anything whose `Origin` is not loopback.
- Each prediction is one small auxiliary call. Debug logging is off by default and never logs the transcript, only event names and counts.

## Limitations

- Web only; there is no TUI or Desktop surface.
- Tab acceptance is scoped: a capture-phase handler intercepts Tab only while the card is visible and the composer has focus. Everywhere else Tab remains focus traversal. It is not registered as a global shortcut.
- Predictions are whole messages. The card does not complete text you are already typing, and it does not appear while the composer is non-empty.
- One model call per turn, plus one when opening an idle session with no cached card, plus one per `↻` click.
- UI copy is Chinese or English based on `navigator.language`, not the full DSH locale service.

## Development

```
├─ index.js            Host: routes, transcript window, model call, parsing
├─ client.js           Browser: slot registration, card UI, request lifecycle
├─ cordis.patch.yml    Bundle row and default config
├─ locale/{en,zh}.json Plugin title and description for the Plugins page
├─ icon.svg            Bundle icon
└─ test/host.test.mjs  Route-level tests with a fake ctx (no DSH runtime)
```

Run the host tests without installing anything:

```bash
npm test          # or: node test/host.test.mjs
```

They cover config, a normal prediction, origin rejection, unknown session, the disabled switch, echo filtering, a truncated JSON array, a user-ended turn, a count override, and the question-only trigger.

When `debug: true`, logging goes to `$DSH_HOME/dsh-next-suggestion/debug.log` (`~/.dsh/dsh-next-suggestion/debug.log` by default). The client reports mount, turn changes, skip reasons, and result counts there, so a missing card can be diagnosed without DevTools.

Local iteration:

```powershell
dsh plugin --profile web add "link:D:/path/to/dsh-next-suggestion"
# edit client.js -> reload the page
# edit index.js  -> restart the host
```

`package.json` has no runtime dependencies: React comes from the browser module table, and the Host imports only Node built-ins.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
