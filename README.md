# EMS 批量查单 Skill（ems-batch）

批量查询中国邮政 EMS 快递单号，每单导出轨迹 PDF，并生成三列汇总表（单号/是否查询成功/是否保存文件）。

## 安装
1. 把 `ems-batch` 文件夹解压/复制到 DSH 的 skills 目录：
   - Windows：`C:\Users\<你的用户名>\.dsh\skills\ems-batch\`
2. 确认已安装 Google Chrome（桌面版）
3. 重启 DSH（或新开会话），skill 即生效

## 使用
对 DSH 说：**"查EMS单号，照片在 D:\xxx目录"**（或贴单号列表 / txt 路径）。

- 首次使用：会弹出 Chrome 窗口，**按提示手动登录 EMS**（账号密码自己输入），登录后自动继续
- 运行中 Chrome 窗口会保持在屏幕上（WAF 要求可见浏览器，属正常现象）
- 完成后在输出目录得到：每单 `<单号>.pdf` + `EMS查询汇总.xlsx`

## 单号来源
- **照片目录**：每张图一个单号（读条形码下方的小数字，通常 13 位）
- **txt 列表**：每行一个单号
- **直接粘贴**：消息里给单号

## 可选配置（环境变量）
| 变量 | 默认 | 说明 |
|---|---|---|
| `EMS_CHROME` | 自动探测 | Chrome 可执行文件路径 |
| `EMS_CHROME_PROFILE` | `%USERPROFILE%\.ems-batch\chrome-profile` | Chrome profile（保存登录态，勿删） |
| `EMS_BATCH_TMP` | `%USERPROFILE%\.ems-batch\tmp` | 临时文件目录 |
| `EMS_CDP_PORT` | 9338 | CDP 调试端口 |

## 注意
- 仅支持 Windows
- 登录态保存在 chrome-profile，删除后需重新登录
- 批量节奏约每单 30-60 秒（含验证码识别），请勿中途关 Chrome 窗口

---

# EMS Batch Tracking Skill (ems-batch)

Batch-query China Post EMS waybill numbers, export a tracking PDF per waybill, and generate a 3-column summary sheet (waybill / query succeeded / file saved).

## Installation
1. Unzip/copy the `ems-batch` folder into DSH's skills directory:
   - Windows: `C:\Users\<your-username>\.dsh\skills\ems-batch\`
2. Make sure desktop Google Chrome is installed
3. Restart DSH (or start a new session) — the skill is then active

## Usage
Tell DSH: **"Query EMS waybills, photos are in D:\xxx"** (or paste a waybill list / txt file path).

- First run: a Chrome window pops up — **log in to EMS manually as prompted** (enter your own credentials); the batch continues automatically after login
- The Chrome window stays visible during the run (the site's WAF requires a visible browser — normal)
- Output: one `<waybill>.pdf` per waybill + `EMS查询汇总.xlsx` (summary) in the output directory

## Waybill sources
- **Photo directory**: one waybill per photo (reads the small digits under the barcode, usually 13 digits)
- **txt list**: one waybill per line
- **Pasted directly**: waybills in the chat message

## Optional configuration (environment variables)
| Variable | Default | Description |
|---|---|---|
| `EMS_CHROME` | auto-detect | Path to Chrome executable |
| `EMS_CHROME_PROFILE` | `%USERPROFILE%\.ems-batch\chrome-profile` | Chrome profile (stores login session — do not delete) |
| `EMS_BATCH_TMP` | `%USERPROFILE%\.ems-batch\tmp` | Temp file directory |
| `EMS_CDP_PORT` | 9338 | CDP debugging port |

## Notes
- Windows only
- Login session is stored in chrome-profile; deleting it requires re-login
- Batch pace is roughly 30-60 s per waybill (including captcha solving); do not close the Chrome window mid-run
