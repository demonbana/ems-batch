// ems_status.mjs — 检查 Chrome/登录态/当前页面
const PORT = Number(process.env.EMS_CDP_PORT || 9338);
let target = null;
for (let i = 0; i < 6; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = targets.find((t) => t.type === "page");
    if (target) break;
  } catch {}
  await new Promise(r => setTimeout(r, 500));
}
if (!target) { console.log(JSON.stringify({ chrome: false })); process.exit(0); }

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
const st = await send("Runtime.evaluate", { expression: `JSON.stringify({
  url: location.href,
  login: document.body.innerText.match(/1[0-9]{1,2}\\*{3,4}[0-9]{4}/)?.[0] || null,
  captchaOpen: document.body.innerText.includes("安全验证")
})` });
const s = JSON.parse(st.result.value);
console.log(JSON.stringify({ chrome: true, ...s }));
ws.close();
process.exit(0);
