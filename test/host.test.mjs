// Local harness for the Host half: no DSH runtime needed.
// Run: node test/host.test.mjs
import { Readable } from 'node:stream'
import { apply } from '../index.js'

const routes = new Map()

function fakeCtx(session, llmText) {
  return {
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    sessions: { get: (id) => (id === 's1' ? session : undefined) },
    llm: {
      async *stream() {
        yield { type: 'text-delta', text: llmText }
        yield { type: 'finish' }
      },
    },
    effect(fn) {
      fn()
    },
  }
}

function fakeRes() {
  return {
    status: 0,
    body: '',
    writableEnded: false,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ?? ''
      this.writableEnded = true
    },
  }
}

function fakeReq({ method = 'POST', origin = 'http://127.0.0.1:3080', body = null } = {}) {
  const stream = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))])
  stream.method = method
  stream.headers = origin === null ? {} : { origin }
  return stream
}

const session = {
  deriveMessages() {
    return [
      { role: 'user', content: [{ type: 'text', text: '这个插件怎么做？' }] },
      { role: 'assistant', content: [{ type: 'text', text: '先看一下插槽。' }, { type: 'tool-call' }] },
    ]
  },
}

const ctx = fakeCtx(session, '```json\n["继续","跑一下测试"]\n```')
apply(ctx, { enabled: true, count: 2 })

const config = routes.get('/plugins/dsh-next-suggestion/config')
const predict = routes.get('/plugins/dsh-next-suggestion/predict')
if (!config || !predict) throw new Error('routes not registered')

const results = []

// 1. config
{
  const res = fakeRes()
  await config(fakeReq({ method: 'GET' }), res)
  results.push(['config', res.status, res.body])
}

// 2. predict
{
  const res = fakeRes()
  await predict(fakeReq({ body: { sessionId: 's1' } }), res)
  results.push(['predict', res.status, res.body])
}

// 3. foreign origin
{
  const res = fakeRes()
  await predict(fakeReq({ origin: 'https://evil.example', body: { sessionId: 's1' } }), res)
  results.push(['origin', res.status, res.body])
}

// 4. unknown session
{
  const res = fakeRes()
  await predict(fakeReq({ body: { sessionId: 'missing' } }), res)
  results.push(['missing', res.status, res.body])
}

// 5. disabled
{
  routes.clear()
  apply(fakeCtx(session, '["x"]'), { enabled: false, count: 2 })
  const res = fakeRes()
  await routes.get('/plugins/dsh-next-suggestion/predict')(fakeReq({ body: { sessionId: 's1' } }), res)
  results.push(['disabled', res.status, res.body])
}

// 6. echo filter: a candidate repeating the user's own message is dropped
{
  routes.clear()
  apply(fakeCtx(session, '["这个插件怎么做？","改成三条候选"]'), { enabled: true, count: 2 })
  const res = fakeRes()
  await routes.get('/plugins/dsh-next-suggestion/predict')(fakeReq({ body: { sessionId: 's1' } }), res)
  results.push(['echo', res.status, res.body])
}

// 7. truncated JSON: salvage the complete first string, never surface the array
{
  routes.clear()
  apply(
    fakeCtx(session, '["图标发你了，放 assets/icon.png，F5 看看效果","搜出来的不相关包还是太多，先只保留 keywords 里带 d'),
    { enabled: true, count: 2 },
  )
  const res = fakeRes()
  await routes.get('/plugins/dsh-next-suggestion/predict')(fakeReq({ body: { sessionId: 's1' } }), res)
  results.push(['truncated', res.status, res.body])
}

// 8. the newest message is the user's: there is no assistant turn to answer
{
  const userEnded = {
    deriveMessages() {
      return [
        { role: 'user', content: [{ type: 'text', text: '先做这个' }] },
        { role: 'assistant', content: [{ type: 'text', text: '好，我来。' }] },
        { role: 'user', content: [{ type: 'text', text: '等一下，先别改' }] },
      ]
    },
  }
  routes.clear()
  apply(fakeCtx(userEnded, '["不该出现"]'), { enabled: true, count: 2 })
  const res = fakeRes()
  await routes.get('/plugins/dsh-next-suggestion/predict')(fakeReq({ body: { sessionId: 's1' } }), res)
  results.push(['last-user', res.status, res.body])
}

// 9. the Client may override the candidate count for one request
{
  routes.clear()
  apply(fakeCtx(session, '["一","二"]'), { enabled: true, count: 2 })
  const res = fakeRes()
  await routes.get('/plugins/dsh-next-suggestion/predict')(fakeReq({ body: { sessionId: 's1', count: 1 } }), res)
  results.push(['count-override', res.status, res.body])
}

// 10. onlyQuestion: the assistant turn ended with a statement, not a question
{
  routes.clear()
  apply(fakeCtx(session, '["不该出现"]'), { enabled: true, count: 2 })
  const res = fakeRes()
  await routes.get('/plugins/dsh-next-suggestion/predict')(fakeReq({ body: { sessionId: 's1', onlyQuestion: true } }), res)
  results.push(['only-question', res.status, res.body])
}

for (const row of results) console.log(row.join(' | '))

const failures = []
const expect = (name, ok, actual) => {
  if (!ok) failures.push(`${name}: ${actual}`)
}
expect('config', results[0][1] === 200 && JSON.parse(results[0][2]).count === 2, results[0][2])
expect('predict', results[1][1] === 200 && JSON.parse(results[1][2]).items.length === 2, results[1][2])
expect('origin', results[2][1] === 403, results[2][2])
expect('missing', results[3][1] === 200 && JSON.parse(results[3][2]).items.length === 0, results[3][2])
expect('disabled', results[4][1] === 200 && JSON.parse(results[4][2]).items.length === 0, results[4][2])
expect(
  'echo',
  results[5][1] === 200 &&
    JSON.parse(results[5][2]).items.length === 1 &&
    JSON.parse(results[5][2]).items[0] === '改成三条候选',
  results[5][2],
)
expect(
  'truncated',
  results[6][1] === 200 &&
    JSON.parse(results[6][2]).items.length === 1 &&
    JSON.parse(results[6][2]).items[0] === '图标发你了，放 assets/icon.png，F5 看看效果',
  results[6][2],
)
expect('last-user', results[7][1] === 200 && JSON.parse(results[7][2]).items.length === 0, results[7][2])
expect('count-override', results[8][1] === 200 && JSON.parse(results[8][2]).items.length === 1, results[8][2])
expect('only-question', results[9][1] === 200 && JSON.parse(results[9][2]).items.length === 0, results[9][2])

if (failures.length > 0) {
  console.error('FAIL', failures)
  process.exit(1)
}
console.log('all host tests passed')
