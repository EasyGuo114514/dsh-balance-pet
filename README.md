# dsh-balance-pet

给 **DeepSeek Harness** 用的余额与峰谷时段小人。

它解决两件具体的事:

1. **余额不明显** —— 右下角常驻一个余额读数,不用再翻设置页。
2. **峰谷时段看不出来** —— 高峰(2 倍价)和低谷实时判定并显示;高峰期小人会提醒你一句。

在此之上,它还是一只 Q 版小人:三种形态、24 套表情、会说话、会跑、能看懂 DSH 正在思考什么。
另外附一个**独立的桌面小人窗口**,可以跨屏幕走来走去 —— 不只是待在 DSH 窗口里。

---

## 峰谷规则(这是权威依据,不是我编的)

来自 DeepSeek 官方定价页,原文:

> Off-peak rates are half of the peak rates. Peak hours are **01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays**. All other hours are off-peak, including weekends and Chinese public holidays in full.

因此:

| | |
|---|---|
| 高峰(2 倍价) | UTC 01:00–04:00 与 06:00–10:00,**周一至周五**,排除中国法定节假日 |
| 局部时间(UTC+8) | 09:00–12:00 与 14:00–18:00 |
| 其余全部 | 低谷价(高峰价的一半) |

三个容易踩的坑,本插件都按官方字面处理,并且有测试盯着:

- **节假日整天算低谷**,哪怕它落在高峰窗口里(例如国庆期间的周一上午)。
- **周末整天算低谷**,包括调休补班日 —— 官方写的是"Monday through Friday",补班日是周末,所以按字面算低谷。
  想按"实际上班日"算,把 `treatMakeupWorkdaysAsWeekday` 打开。
- **窗口是左闭右开**:04:00 整已经离开高峰,不是还在里面。

**节假日数据会过期。** 国务院每年约 11 月公布次年安排,数据文件目前覆盖到 **2026 年**;
设置页会显示数据截止年份,跨年后会在界面上提示可能判错。可以用 `holidays` 配置覆盖或补录。

> ⚠️ **口径提醒**:余额取的是 **DeepSeek 官方账号余额**,峰谷也是**官方 API 规则**。
> 如果你当前模型走的是第三方中转(例如 `ds` 路由的免费档),峰谷提示反映的是官方计费口径,
> 不一定等于中转站的实际扣费。`peakScope: 'off'` 可以关掉峰谷提示。

---

## 安装

本插件是标准的 DSH bundle(`dsh.bundle.patch` + `dsh.client`),安装方式是把它加进 profile。
本机已装好的形态是 `link:` 依赖,源码即插件目录,不需要构建。

```powershell
# 1) 加进 desktop profile 的依赖与 bundle 列表
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$src     = "C:\Users\Easy_Guo\Documents\deepseek-harness\default-workspace\dsh-balance-pet"

# package.json: dependencies 里加 link: 依赖;dsh.profile.bundles 里加包名
# node_modules/@local 下建符号链接指向 $src
New-Item -ItemType Directory -Force -Path "$profile\node_modules\@local" | Out-Null
New-Item -ItemType SymbolicLink -Force -Path "$profile\node_modules\@local\dsh-balance-pet" -Target $src

# 2) 重启 DeepSeek Harness(新增 bundle 行必须重启才生效)
& "$env:USERPROFILE\.dsh\dsh-restart.ps1"
```

> 本仓库附了一个 `install.ps1`,上面这些步骤它会一次做完(含改 `package.json`、建软链、校验 JSON)。

### 重启后怎么确认它活了

浏览器页面无法被本插件读取 DOM,所以状态不靠页面,靠**桥日志**:

```powershell
Get-Content "$env:USERPROFILE\.dsh\balance-pet\bridge.log" -Tail 20
Get-Content "$env:USERPROFILE\.dsh\balance-pet\bridge.json"
```

- `mounted (...)` = Host 半已加载。
- `bridge listening on 127.0.0.1:<port>` = 桥已就绪。
- `client half mounted` = **DSH 页面里的小人真的渲染出来了**(Client 半挂载后会回调桥)。

---

## 桌面小人(跨屏幕跑)

DSH 插件跑在 Host 的 Node 进程里,拿不到 Electron 的窗口 API,所以"在电脑里跑"必须是一个独立窗口。
`desktop/` 就是它:透明、无边框、置顶、点击穿透,沿着**所有显示器的联合工作区**走动,会从一块屏走到另一块屏。

```powershell
cd desktop
npm install          # 会下载 Electron 运行时(约 150MB)
npm start
```

- 鼠标移到小人身上才会接管点击,其余区域点击穿透,不会挡住你正常操作。
- 双击小人关闭它。
- Host 重启后端口会变,桌面小人会自己读 `bridge.json` 重新连上,不会卡死。

---

## 配置

在 profile 的 `cordis.patch.yml` 里给 `balance-pet` 行加 `config`:

```yaml
- id: balance-pet
  name: '@local/dsh-balance-pet'
  config:
    peakScope: official              # official | off
    warnOnPeak: true                 # 峰时提醒(默认**只提醒,不拦截**)
    treatMakeupWorkdaysAsWeekday: false
    idleChatter: true                # 空闲主动搭话
    idleMinMs: 90000
    idleMaxMs: 240000
    reactToThinking: true            # 跟随 DSH 思考流换表情说话
    injectIntoConversation: false    # 是否把小人内容注入对话(默认关闭)
    chatProvider: ds
    chatModel: deepseek-v4-flash:free
    chatReasoningEffort: off         # 小人对话关闭思考
    chatMaxPerHour: 40
    holidays:                        # 覆盖内置节假日表;null 表示取消该天
      '2027-01-01': 元旦
```

---

## 架构

```
dsh-balance-pet/
├─ index.js              Host 半:唯一真源(峰谷 + 余额 + 思考分类 + 小人对话)+ 本地回环桥
├─ client.js             Client 半:DSH 窗口内的小人(shell.overlay + settings.section)
├─ shared/               纯函数,零依赖,可被 Node 直接测试
│  ├─ peak.js            峰谷判定(UTC 窗口 + 节假日),含下一次切换时刻
│  ├─ holidays.js        2025–2026 中国法定节假日与调休补班表
│  ├─ budget.js          钱包解析/精确求和/格式化(含 0E-16 这类边界)
│  ├─ situation.js       思考文本 → 情境(纯本地关键词分类,不花钱)
│  ├─ lines.js           台词库、峰谷阶段命名、小人人格提示词
│  └─ character.js       角色绘制(24 表情 × 3 形态),桌面端与 Host 共用这一份
├─ desktop/              独立 Electron 桌面小人
├─ install.ps1           安装/卸载脚本(改 profile + 建软链,带备份与回滚)
└─ test/                 自检 + Host 集成测试 + 桌面测试夹具
```

### 为什么峰谷只在 Host 算一遍

判定依赖 UTC 时钟**和**一份中国节假日表。如果每个界面各算一遍,页面里的小人和桌面上
的小人会开始就"现在是不是双倍价"给出不同答案 —— 这正是这个插件最不该出错的地方。
所以 Host 是唯一真源,Client 半和桌面端都只消费它的快照。

### 桥

`127.0.0.1` 上的 `node:http`,端口随机,凭据是每次安装生成的随机 token:

- `GET /state` / `GET /events`(SSE)—— 需要 token。
- `POST /hello` / `POST /say` —— 需要 token。
- `GET /pet`、`/pet/*.js|css` —— **不需要** token:它们是窗口自己的代码,不含账号数据;
  而桌面窗口是靠 URL 导航打开的,无法附带自定义请求头。

**API key 永远不过桥**:桌面端只拿到 Host 算好的数字和句子,自己不发起任何 Platform 请求。

---

## 已验证 / 未验证

**已验证(可复现):**

```powershell
node test/check.mjs    # 75 项:峰谷边界、节假日、钱包边界、情境分类、两份角色定义一致性、清单校验
node test/host.mjs     # 22 项:真跑 apply(),桥的鉴权/CORS/SSE、余额汇总、思考链路端到端、卸载干净
```

覆盖的关键边界:UTC 00:59/01:00/03:59/04:00/06:00/09:59/10:00、周末、法定节假日、
调休补班、`0E-16` 与 `5.0000000000000000` 这类金额、跨片段到达的思考关键词。

**未验证:** 界面观感。本仓库的作者没有浏览器控制能力,无法截图或读取运行中页面的 DOM,
官方插件规范也明确禁止用自制 mock 页面截图充当验证。因此**像素级的观感需要你自己刷新页面确认**
(深色/浅色主题下的对比度、动画流畅度)。桌面小人提供了一个 `--self-shot=<path>` 开关,
可以让它给自己截一帧,用于自动化核对。

---

## 已知限制

1. **节假日数据有保质期**,见上文。
2. **余额与峰谷口径可能不一致**,见上文提醒。
3. **高峰只提醒不拦截**。默认不会阻止你发送;这是刻意的选择(官方没有提供发送前的插件钩子),
   硬拦截需要走 `agent/pre-step` + 用户提问卡,属于后续工作。
4. **小人自己的对话走的是配置好的模型** (`chatProvider`/`chatModel`,默认思考关闭),
   有每小时调用次数上限(`chatMaxPerHour`,默认 40)。限额是硬上限:一个显示余额的功能,
   绝不能靠烧余额来说话。大多数台词(空闲搭话、思考反应)仍然来自本地台词库,不花 token。
   小人的对话**不会**进入你的会话上下文(`injectIntoConversation` 默认关闭)。
5. **桌面小人需要单独安装 Electron 运行时**(约 150MB)。
6. **角色绘制在两端各有一份实现**(Client 半用 React,桌面端用字符串模板),共享的是同一份
   词汇表与调色板。自检里有一项专门断言两者不会跑偏。共享模块 `shared/character.js`
   由 Host 直接伺服给桌面窗口,所以调色板与表情数据确实只有一份。

## 许可

MIT
