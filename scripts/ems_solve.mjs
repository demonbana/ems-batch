// ems_solve.mjs — 读 <TMP>/clicks.json，按序点字+验证
// clicks.json: {"clicks":[{"x":0.7,"y":0.27},...]}（相对坐标，按模板顺序；box 实时读取）
// 输出 JSON: {verified, detail}
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.EMS_CDP_PORT || 9338);
const TMP = (process.env.EMS_BATCH_TMP || path.join(os.homedir(), ".ems-batch", "tmp")).replace(/\\/g, "/");

let target = null;
for (let i = 0; i < 10; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = targets.find((t) => t.type === "page");
    if (target) break;
  } catch {}
  await new Promise(r => setTimeout(r, 500));
}
if (!target) { console.error("CHROME_NOT_RUNNING"); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(`${TMP}/clicks.json`, "utf8"));
const clicks = cfg.clicks;
if (!Array.isArray(clicks) || !clicks.length) { console.error("BAD_CLICKS_JSON"); process.exit(1); }

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
await send("Runtime.enable");

async function click(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await new Promise(r => setTimeout(r, 120));
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

// re-read box live (page may have scrolled since extraction)
const boxInfo = await send("Runtime.evaluate", { expression: `JSON.stringify(document.querySelector(".text-verify").getBoundingClientRect())` });
const box = JSON.parse(boxInfo.result.value);

// click chars in order
for (const c of clicks) {
  const x = box.x + c.x * box.width;
  const y = box.y + c.y * box.height;
  await click(x, y);
  await new Promise(r => setTimeout(r, 350));
}
await new Promise(r => setTimeout(r, 500));

// click 验证 (smallest element with text 验证)
const btnLoc = await send("Runtime.evaluate", { expression: `(() => {
  const btns = [...document.querySelectorAll("button, [role=button], div, span")].filter(b => (b.innerText || "").trim() === "验证" && b.offsetWidth > 0 && b.offsetHeight > 0);
  if (!btns.length) return "NO_VERIFY_BTN";
  const btn = btns.sort((a, b) => a.offsetWidth * a.offsetHeight - b.offsetWidth * b.offsetHeight)[0];
  const r = btn.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()` });
if (btnLoc.result.value === "NO_VERIFY_BTN") {
  console.log(JSON.stringify({ verified: false, detail: "NO_VERIFY_BTN" }));
  process.exit(1);
}
const b = JSON.parse(btnLoc.result.value);
await click(b.x, b.y);

// wait for modal to close (verified) or error
let verified = false, detail = "";
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 500));
  const st = await send("Runtime.evaluate", { expression: `(() => {
    const gone = !document.body.innerText.includes("安全验证");
    const err = (document.body.innerText.match(/(验证失败|错误|不正确|请重新)[^\\n]{0,30}/) || [""])[0];
    return JSON.stringify({ gone, err });
  })()` });
  const s = JSON.parse(st.result.value);
  if (s.gone) { verified = true; detail = "modal closed"; break; }
  if (s.err) { detail = s.err; break; }
}
if (!verified && !detail) detail = "timeout";

// result screenshot for agent
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(`${TMP}/after_verify.png`, Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({ verified, detail, shot: `${TMP}/after_verify.png` }));
ws.close();
process.exit(0);
