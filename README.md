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
