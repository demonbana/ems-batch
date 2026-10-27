// ems_query.mjs <单号> | ems_query.mjs --login
// <单号>: 填单号、点查询、抓验证码图+模态框截图 → JSON {ok, num, capImg, modalShot, box, imgW, imgH}
// --login: 打开 EMS 页面并等待用户手动登录（轮询登录态，最长 5 分钟）
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---- portable config (override via env) ----
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
];
const CHROME = process.env.EMS_CHROME || CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const PORT = Number(process.env.EMS_CDP_PORT || 9338);
const BASE = process.env.EMS_BATCH_HOME || path.join(os.homedir(), ".ems-batch");
const PROFILE = process.env.EMS_CHROME_PROFILE || path.join(BASE, "chrome-profile");
const TMP = (process.env.EMS_BATCH_TMP || path.join(BASE, "tmp")).replace(/\\/g, "/");
const ARGS = process.argv.slice(2);
const MODE = ARGS[0] === "--login" ? "login" : "query";
const NUM = MODE === "query" ? ARGS[0] : null;
if (MODE === "query" && !NUM) { console.error("usage: ems_query.mjs <单号> | ems_query.mjs --login"); process.exit(1); }
if (!CHROME) { console.error("CHROME_NOT_FOUND 未找到 Chrome，请安装或设置 EMS_CHROME 环境变量"); process.exit(1); }
fs.mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// start chrome if not running
let target = null;
for (let i = 0; i < 4; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = targets.find((t) => t.type === "page");
    if (target) break;
  } catch {}
  await sleep(500);
}
if (!target) {
  spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check",
    "--window-size=1366,900", "--lang=zh-CN", "about:blank",
  ], { stdio: "ignore", detached: true }).unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = targets.find((t) => t.type === "page");
      if (target) break;
    } catch {}
  }
}
if (!target) { console.error("CHROME_NOT_RUNNING"); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
await new Promise((r) => (ws.onopen = r));
await send("Network.enable");
await send("Runtime.enable");
await send("Page.enable");

async function click(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(100);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

// fresh query page (about:blank first — SPA state survives same-URL navigate/reload)
await send("Page.navigate", { url: "about:blank" });
await sleep(1000);
await send("Page.navigate", { url: "https://www.ems.com.cn/queryList?current=0" });
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const { result: { value: len } } = await send("Runtime.evaluate", { expression: "document.readyState === 'complete' ? document.documentElement.outerHTML.length : 0" });
  if (len > 10000) break;
}
await sleep(1500);

// login check
const login = await send("Runtime.evaluate", { expression: `document.body.innerText.match(/1[0-9]{1,2}\\*{3,4}[0-9]{4}/)?.[0] || ""` });
if (MODE === "login") {
  if (login.result.value) {
    console.log(JSON.stringify({ ok: true, mode: "login", logged_in: true, masked: login.result.value }));
    ws.close(); process.exit(0);
  }
  console.log(JSON.stringify({ ok: true, mode: "login", logged_in: false, hint: "请在弹出的 Chrome 窗口中登录 EMS（右上角 登录/我的EMS），登录后重新运行 ems_query.mjs --login 确认" }));
  // poll up to 5 min for user to log in manually
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const r = await send("Runtime.evaluate", { expression: `document.body.innerText.match(/1[0-9]{1,2}\\*{3,4}[0-9]{4}/)?.[0] || ""` });
    if (r.result.value) {
      console.log(JSON.stringify({ ok: true, mode: "login", logged_in: true, masked: r.result.value, waited_s: (i + 1) * 5 }));
      ws.close(); process.exit(0);
    }
  }
  console.log(JSON.stringify({ ok: false, mode: "login", logged_in: false, error: "LOGIN_TIMEOUT 5 分钟内未检测到登录" }));
  ws.close(); process.exit(1);
}
if (!login.result.value) {
  console.error("NOT_LOGGED_IN 请先运行 ems_query.mjs --login 完成 EMS 登录，再执行批量查询");
  process.exit(1);
}

// locate input + button
const loc = await send("Runtime.evaluate", { expression: `(() => {
  const input = document.querySelector('input[placeholder*="邮件号"]');
  const btns = [...document.querySelectorAll("button")].filter(b => (b.innerText || "").trim() === "查询" && b.offsetWidth > 0);
  const btn = btns.sort((a, b) => a.offsetWidth * a.offsetHeight - b.offsetWidth * b.offsetHeight)[0];
  if (!input || !btn) return "MISSING";
  const ri = input.getBoundingClientRect();
  const rb = btn.getBoundingClientRect();
  return JSON.stringify({ ix: ri.x + ri.width / 2, iy: ri.y + ri.height / 2, bx: rb.x + rb.width / 2, by: rb.y + rb.height / 2 });
})()` });
if (loc.result.value === "MISSING") { console.error("INPUT_MISSING"); process.exit(1); }
const L = JSON.parse(loc.result.value);

// focus (JS + mouse), clear, insert (NO Enter — Enter pre-commits chip and breaks the 查询 click)
await send("Runtime.evaluate", { expression: `document.querySelector('input[placeholder*="邮件号"]').focus()` });
await sleep(200);
await click(L.ix, L.iy);
await sleep(300);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
await sleep(200);
await send("Input.insertText", { text: NUM });
await sleep(500);
let val = (await send("Runtime.evaluate", { expression: `document.querySelector('input[placeholder*="邮件号"]').value` })).result.value;
if (!val) {
  // retry once
  await click(L.ix, L.iy);
  await sleep(300);
  await send("Input.insertText", { text: NUM });
  await sleep(500);
  val = (await send("Runtime.evaluate", { expression: `document.querySelector('input[placeholder*="邮件号"]').value` })).result.value;
}
if (!val) { console.error("INPUT_FAILED"); process.exit(1); }

// click 查询 (re-locate; scrollIntoView MUST be instant — smooth animation makes coords stale)
const loc2 = await send("Runtime.evaluate", { expression: `(() => {
  const btns = [...document.querySelectorAll("button")].filter(b => (b.innerText || "").trim() === "查询" && b.offsetWidth > 0);
  const btn = btns.sort((a, b) => a.offsetWidth * a.offsetHeight - b.offsetWidth * b.offsetHeight)[0];
  if (!btn) return "MISSING";
  const r0 = btn.getBoundingClientRect();
  if (r0.x < 0 || r0.x > window.innerWidth || r0.y < 0 || r0.y > window.innerHeight) {
    btn.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
  }
  const rb = btn.getBoundingClientRect();
  return JSON.stringify({ bx: rb.x + rb.width / 2, by: rb.y + rb.height / 2 });
})()` });
if (loc2.result.value === "MISSING") { console.error("BTN_MISSING_AFTER_CHIP"); process.exit(1); }
const L2 = JSON.parse(loc2.result.value);
await click(L2.bx, L2.by);

// wait for captcha modal
let capData = null;
for (let i = 0; i < 24; i++) {
  await sleep(500);
  const r = await send("Runtime.evaluate", { expression: `(() => {
    const cap = document.querySelector(".text-verify");
    if (!cap) return "none";
    const r = cap.getBoundingClientRect();
    const bg = getComputedStyle(cap).backgroundImage;
    const m = bg.match(/data:image\\/(\\w+);base64,([A-Za-z0-9+/=]+)/);
    if (!m) return "none";
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, fmt: m[1], b64: m[2] });
  })()` });
  if (r.result.value !== "none") { capData = JSON.parse(r.result.value); break; }
}
if (!capData) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${TMP}/debug.png`, Buffer.from(shot.data, "base64"));
  console.error("NO_CAPTCHA debug=" + `${TMP}/debug.png`);
  process.exit(1);
}

// save captcha image + measure natural size
const capImg = `${TMP}/cap.${capData.fmt}`;
fs.writeFileSync(capImg, Buffer.from(capData.b64, "base64"));
const nat = await send("Runtime.evaluate", { awaitPromise: true, expression: `new Promise(res => {
  const im = new Image();
  im.onload = () => res(JSON.stringify({ w: im.naturalWidth, h: im.naturalHeight }));
  im.onerror = () => res(JSON.stringify({ w: 560, h: 366 }));
  im.src = "data:image/${capData.fmt};base64,${capData.b64}";
})` });
const { w: imgW, h: imgH } = JSON.parse(nat.result.value);

// modal screenshot
const shot = await send("Page.captureScreenshot", { format: "png" });
const modalShot = `${TMP}/modal.png`;
fs.writeFileSync(modalShot, Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({
  ok: true, num: NUM, capImg, modalShot,
  box: { x: capData.x, y: capData.y, w: capData.w, h: capData.h },
  imgW, imgH,
}));
ws.close();
process.exit(0);
