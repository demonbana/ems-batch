name: ems-batch
description: 批量查询中国邮政 EMS 快递单号并导出 PDF。触发词：查EMS单号、EMS查询、EMS转PDF、批量查快递、单号照片目录。支持三种输入：①单号照片目录（每张一张单号，视觉识别条形码下方数字）②txt 单号列表 ③直接粘贴单号。流程：CDP 驱动可见 Chrome 过 WAF → 邮件号查询 → 视觉识别"按序点字"验证码（颜色质心法定位）→ 详情页展开全部轨迹 → 竖版 A4 60% 打印 PDF 到指定目录 → 生成三列汇总表（单号/是否查询成功/是否保存文件）。
---

# EMS 批量查单 + PDF 导出

## 环境要求
- **Windows** + Google Chrome（脚本自动探测常见安装路径，也可用 `EMS_CHROME` 环境变量指定）
- **DSH**（脚本用 DSH 自带 Node v24 运行，原生 WebSocket，无需另装）
  - Node：`<DSH安装目录>\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`
  - Python（质心计算，openpyxl 已内置）：同目录 `\python\python.exe`
- 一个 EMS 账号（首次使用需登录，见下）
- 数据目录（自动创建，可覆盖）：`%USERPROFILE%\.ems-batch\`
  - `chrome-profile\` — Chrome 独立 profile（保存登录态，**勿删**）
  - `tmp\` — 验证码图、模板图、clicks.json、截图
- 环境变量（均可选）：`EMS_CHROME`、`EMS_CHROME_PROFILE`、`EMS_BATCH_TMP`、`EMS_BATCH_HOME`、`EMS_CDP_PORT`（默认 9338）

## 登录（首次使用或登录态失效时，必须先做）
1. `node ems_query.mjs --login` → 启动可见 Chrome 并打开 EMS 查询页
2. **提示用户**：在弹出的 Chrome 窗口右上角点"登录/我的EMS"，用 EMS 账号手动登录（账号密码由用户自己输入，agent 不接触）
3. 脚本轮询登录态（顶栏出现脱敏手机号即成功，最长等 5 分钟）
4. 登录成功后再开始批量。之后登录态保存在 chrome-profile，无需重复登录
5. 批量中若 `ems_query.mjs` 报 `NOT_LOGGED_IN` → 回到本流程重新登录

## 输入模式
1. **照片目录**（常用）：目录里每张图一个单号。单号 = **条形码下方的小数字**（通常 13 位，如 1311333273828；也可能是 EA+9位+CN）。逐张 read_image 识别；照片模糊或识别不确定时**停下来问用户**，不猜。
2. **txt 列表**：每行一个单号。
3. **直接粘贴**：消息里的单号。

输出目录 = 用户指定的目录（照片模式 = 照片所在目录）。

## 每单流程（严格按序）
1. `node ems_query.mjs <单号>`
   → 输出 JSON：`{ok, num, capImg, modalShot, box, imgW, imgH}`。失败时看输出里的 debug 截图排查。
2. **提取模板图**（顺序文字是独立图片，不是 DOM 文本）：
   页面 `.text-info img` 的 src（data URI）→ 存 `<tmp>\template.png`（286x76）
3. **视觉识别**（agent 核心工作，必须 agent 做）：
   - read_image `capImg`：识别 5 个汉字（4 目标 + 1 干扰）及各自**大致**中心位置（目测误差 ±25px 内即可）
   - read_image `template.png`：读目标点击顺序（花体字，易误认）
   - **消歧规则**：模板里的字必须都存在于验证码图中——用此约束修正误认（如模板首字像"失"但图里没有，就找图里结构最接近的字）
4. **精确质心**（必做！目测有 ~10px 系统偏差，服务器命中半径小，目测坐标会失败）：
   `python ems_centroids.py <capImg> <cx1,cy1> <cx2,cy2> <cx3,cy3> <cx4,cy4> <cx5,cy5>`（5 个目测位置，按模板顺序排）
   → 输出每个字的精确相对坐标 rx/ry
5. 写 `<tmp>\clicks.json`：`{"clicks":[{"x":rx,"y":ry},...]}`（按模板顺序）
   → `node ems_solve.mjs` → `{verified:true}` 才算过
   - `verified:false, detail:"验证失败"` → 重跑步骤 1（新验证码），**最多重试 3 次**
   - `verified:false, detail:"timeout"` → **先查页面状态**（url 是否已到 queryLogistics、有无轨迹）——查询可能已成功、只是弹窗卡住，别盲目重试
6. `node ems_pdf.mjs <单号> <输出目录>`
   → `{ok, pdf, kb, verifyShot, track}`。read_image `verifyShot` 确认：轨迹完整、右侧无裁切
7. 间隔 **10-20 秒**再下一单（防风控）

## 验证码机制（已逆向，勿踩坑）
- 组件 ClickVerify：点击用 `offsetX/offsetY`（相对 .text-verify div），发送归一化坐标 `offsetX/400, offsetY/261.43` 给服务器匹配
- `t` 字段 = 100/200/300/400（序号×100），**无时间节奏分析**
- **clickData 只记前 4 次点击**——严禁在 .text-verify 上做任何测试/探针点击，会污染真实序列（曾因此整单失败）
- 验证码图 560x366，显示 400x261.43（÷1.4）
- 验证成功后页面自动跳 queryLogistics 详情页；弹窗偶尔卡住不关（查询已成功），点 X 或忽略
- 页面加载会**自动恢复上一次的单号 chip**（SPA 状态）——ems_query 已用 about:blank 强制清状态
- 填单号**不要按 Enter**（Enter 预提交 chip 后点"查询"无反应）；按钮在视口外时 `scrollIntoView({behavior:"instant"})`（平滑滚动会让坐标漂移）

## 结果判定（汇总表三列）
- **是否查询成功**：详情页出现"邮件轨迹"+ 具体轨迹事件 = 是；页面显示"未查到此邮件" = 否（**仍生成 PDF**，页面原样存档）
- **是否保存文件**：PDF 文件存在且 >100KB = 是

## 汇总表
全部跑完，用 Python（openpyxl）生成 `<输出目录>\EMS查询汇总.xlsx`：
三列：**单号 | 是否查询成功 | 是否保存文件**（值用"是/否"）。
完成后向用户汇报：总数/成功数/失败单号列表 + 汇总表路径。

## 注意事项
- 每单 PDF 文件名 = 单号.pdf，存输出目录
- 详情页"展开全部"必须 JS el.click()（鼠标点击无效），脚本已处理
- 地图瓦片打印时不渲染（PDF 地图空白属正常，文字信息完整）
- 中途用户可随时叫停；已完成的 PDF 和进度保留
- 残留 Chrome 进程占 CDP 端口会导致新实例起不来：先结束 Chrome 进程再跑
- WAF 限制：headless Chrome 被指纹拦截、纯 HTTP 405/412——**必须可见 Chrome**（窗口会弹到用户屏幕，正常现象，提前告知）
