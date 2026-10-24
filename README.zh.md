# dsh-next-suggestion · 下一句

在 DeepSeek Harness 里预测你下一句要说什么，在输入框上方给几条候选。点一条就填进输入框，改完照常发送。

```
┌ 下一句 ───────────────────────────── 3 ─ ▾ ┐
│ 把 count 改成 3，先跑一轮看看              │
│ 配置是热的，不用重启吧                     │
│ 先别动模型，看看三条里有没有凑数的         │
└────────────────────────────────────────────┘
```

> English: [README.md](README.md)

## 功能

- 每轮助手回复结束后触发；切回一个空闲会话时也会补一次。
- 只读当前会话：最近 12 条消息 + 会话开头那条任务描述。
- 给 1–3 条完整句子，按可能性排序，语言跟对话一致。
- 点击、`Tab`、`→` 都能接受；填入走官方 `InputActions`，撤销栈正常。
- 可收起成「只留最可能的一条」，也可关掉这一轮的卡片。
- `↻` 换一批（提高温度重问一次）。
- 连续五次没用就自动降频，改成每三轮试一次。
- 不自动发送，不改你已经打进去的字。
- 失败静默：模型慢了或挂了，就是没有卡片，不弹错。

## 环境要求

- 跑 Web UI 的 DSH profile（`dsh web`）。
- 已配置模型 provider；默认走 `deepseek-official` 的 `deepseek-flash`。
- 在 DSH `0.2.1-rc.2` 上验证过。

## 安装

从本地目录安装（不需要发 npm）：

```powershell
dsh plugin --profile web add "link:/绝对路径/dsh-next-suggestion"
```

`dsh plugin` 会同时写依赖和 `dsh.profile.bundles`。重启一次 Host 让新 bundle 进入组合，再刷新页面。

发到 npm 之后，直接用包名装：

```powershell
dsh plugin --profile web add dsh-next-suggestion
```

卸载：

```powershell
dsh plugin --profile web remove dsh-next-suggestion
```

如果 `dsh.profile.bundles` 里还留着条目，手动删掉，再重启。

## 使用

助手回完一轮，输入框上方出现卡片：

- **点某一行**：整句填进输入框，光标落在末尾，不会发送。
- **Tab / →**：输入框为空且聚焦时，接受第一条。`→` 只在空输入框里生效，那里它本来也没别的事可做。
- **Esc**：收起卡片。
- **▾ / ▸**：收起为最可能的一条，或重新展开；状态按会话记在 `localStorage`。
- **↻**：换一批，提高温度重问一次，多花一次调用。
- **×**：关掉这一轮。切会话、刷新页面都不会再出现，直到下一轮开始。

只有输入框为空、没有附件、没有排队消息、会话不在跑的时候才会出现。

## 配置

改 profile 的 `~/.dsh/profiles/<profile>/cordis.patch.yml`。同名条目会整段替换 `config`，所以要改哪几项就写全哪几项：

```yaml
- id: dsh-next-suggestion
  name: dsh-next-suggestion
  config:
    enabled: true          # 总开关
    count: 3               # 候选条数，1–3
    provider: deepseek-official
    model: deepseek-flash
    maxMessages: 12        # 取多少条对话
    messageChars: 1200     # 每条截断长度
    timeoutMs: 15000
    maxOutputTokens: 4000  # 只是封顶，写完就停
    debug: false           # 写 $DSH_HOME/dsh-next-suggestion/debug.log
```

配置热生效；JavaScript 代码不会，改完 `index.js` / `client.js` 要重启 Host（浏览器端刷新页面即可）。

`maxOutputTokens` 是上限不是预算：模型写完就停，调大不会让每轮都变慢或变贵。

## 实现方式

**浏览器端**注册 `conversation.input.dock`（`order: 10`），盯 `session.running`，回合结束后等 250ms 再请求 Host。结果按会话在内存里缓存两分钟，切回来不重复花钱。开始打字、发送、切会话都会取消请求并清掉卡片。

**Host 端**三条只监听回环地址的路由：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/plugins/dsh-next-suggestion/config` | 返回 `{ enabled, count, debug }` |
| `POST` | `/plugins/dsh-next-suggestion/predict` | body `{ sessionId }` → `{ items: string[] }` |
| `POST` | `/plugins/dsh-next-suggestion/debug` | 浏览器端诊断打点，仅 `debug: true` 时注册 |

`predict` 用 `session.deriveMessages()` 取最近 12 条 user/assistant 文本：助手消息保留开头 350 字和结尾 1200 字（结论和问题在结尾），最前面附上会话第一条用户消息当任务背景，然后让模型输出 JSON 数组。解析容忍代码围栏、被截断的数组、按行列表；复读用户最近消息的候选会被丢掉，也不会把 `["..."]` 这种序列化残渣显示出来。

请求受 `timeoutMs` 约束，浏览器断开就中止。

## 隐私与成本

- 只读当前会话的文本，不碰附件、文件、其他会话和工作区内容。
- 这段对话会发给 `provider` / `model` 指定的服务，走你聊天用的同一个账号和额度。
- 路由注册在 `/api` 鉴权之外，所以自己校验 `Origin`，非回环一律拒绝。
- 每次预测是一次小请求。调试日志默认关闭，且只记事件名和条数，不记对话内容。

## 已知限制

- 只有 Web 端，没有 TUI / Desktop 版本。
- Tab 接受是有范围的：只在卡片可见、输入框聚焦时由捕获阶段拦截。其他时候 Tab 仍是焦点切换，没有注册全局快捷键。
- 预测的是整句。你已经打了一半的字不会被补全，输入框非空时也不出卡片。
- 每轮一次模型调用；打开没有缓存的空闲会话再补一次；每次点 `↻` 再加一次。
- 界面文案按 `navigator.language` 在中英文之间切，没有接完整的 DSH locale 服务。

## 开发

```
├─ index.js            Host：路由、上下文窗口、模型调用、解析
├─ client.js           浏览器：slot 注册、卡片 UI、请求生命周期
├─ cordis.patch.yml    bundle 行与默认配置
├─ locale/{en,zh}.json Plugins 页显示的标题和描述
├─ icon.svg            bundle 图标
└─ test/host.test.mjs  假 ctx 的路由测试，不需要 DSH 运行时
```

跑测试：

```bash
npm test          # 或 node test/host.test.mjs
```

覆盖配置、正常预测、非法 Origin、未知会话、关闭开关、复读过滤、截断 JSON 七种情况。

`debug: true` 时日志写到 `$DSH_HOME/dsh-next-suggestion/debug.log`（默认 `~/.dsh/dsh-next-suggestion/debug.log`）。浏览器端会把挂载、回合变化、跳过原因、结果条数打到这里，卡片不出来时不用开 DevTools 也能定位。

本地迭代：

```powershell
dsh plugin --profile web add "link:D:/path/to/dsh-next-suggestion"
# 改 client.js -> 刷新页面
# 改 index.js  -> 重启 Host
```

包本身没有运行时依赖：React 来自浏览器模块表，Host 只用 Node 内置模块。

## 许可证

MIT，见 [LICENSE](LICENSE)。
