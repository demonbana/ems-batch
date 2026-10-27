// ems_pdf.mjs <单号> <输出目录> — 详情页展开全部 + 竖版A4 60% 打印 PDF
// 输出 JSON: {ok, num, pdf, kb, verifyShot}
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.EMS_CDP_PORT || 9338);
const TMP = (process.env.EMS_BATCH_TMP || path.join(os.homedir(), ".ems-batch", "tmp")).replace(/\\/g, "/");
const NUM = process.argv[2];
const OUTDIR = process.argv[3];
if (!NUM || !OUTDIR) { console.error("usage: ems_pdf.mjs <单号> <输出目录>"); process.exit(1); }
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUTDIR, { recursive: true });

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
await send("Page.enable");
await send("Runtime.enable");

// detail page
await send("Page.navigate", { url: "https://www.ems.com.cn/queryLogistics?current=0" });
await new Promise(r => setTimeout(r, 5000));

// wait for result + map (up to 30s)
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const m = await send("Runtime.evaluate", { expression: `(() => {
    const imgs = [...document.querySelectorAll("img")].filter(el => (el.src || "").startsWith("http") && (el.src || "").match(/tile|map|webrd|gt0|gt1|gt2|gt3|gtt/i)).length;
    const canvases = [...document.querySelectorAll("canvas")].filter(c => c.width > 100).length;
    return JSON.stringify({ imgs, canvases, ready: document.body.innerText.includes("邮件轨迹") || document.body.innerText.includes("未查到") });
  })()` });
  const st = JSON.parse(m.result.value);
  if (st.ready && (st.imgs > 3 || st.canvases > 0)) break;
}
await new Promise(r => setTimeout(r, 3000));

// expand all via JS click (mouse click doesn't work)
for (let round = 0; round < 4; round++) {
  const r = await send("Runtime.evaluate", { expression: `(() => {
    const els = [...document.querySelectorAll("*")].filter(el => (el.innerText || "").trim() === "展开全部" && el.children.length <= 2 && el.offsetWidth > 0);
    if (!els.length) return "GONE";
    const el = els[0];
    el.scrollIntoView({ block: "center" });
    el.click();
    return "CLICKED";
  })()` });
  if (r.result.value === "GONE") break;
  await new Promise(r => setTimeout(r, 1200));
}
await new Promise(r => setTimeout(r, 1500));

// capture tracking text (for 查询成功判定)
const trackInfo = await send("Runtime.evaluate", { expression: `(() => {
  const t = document.body.innerText;
  const notFound = t.includes("未查到此邮件");
  const status = (t.match(/(本人收|待取件|派送中|运送中|已揽收|已签收|清关中|运输中)[^\\n]{0,6}/g) || []).slice(0, 3);
  const head = (t.match(/邮件轨迹[\\s\\S]{0,120}/) || [""])[0].replace(/\\n/g, " | ");
  return JSON.stringify({ notFound, status, head });
})()` });
console.log("TRACK:", trackInfo.result.value);

// print portrait A4 60%
const { data } = await send("Page.printToPDF", {
  landscape: false, displayHeaderFooter: false, printBackground: true,
  scale: 0.6, paperWidth: 8.27, paperHeight: 11.69,
  marginTop: 0.1, marginBottom: 0.1, marginLeft: 0.1, marginRight: 0.1,
});
const pdfPath = `${OUTDIR.replace(/\\/g, "/")}/${NUM}.pdf`;
fs.writeFileSync(pdfPath, Buffer.from(data, "base64"));
const kb = (Buffer.from(data, "base64").length / 1024).toFixed(0);

// verify: open pdf in chrome, screenshot
await send("Page.navigate", { url: `file:///${pdfPath.replace(/\\/g, "/")}` });
await new Promise(r => setTimeout(r, 3000));
const shot = await send("Page.captureScreenshot", { format: "png" });
const verifyShot = `${TMP}/verify_${NUM}.png`;
fs.writeFileSync(verifyShot, Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({ ok: true, num: NUM, pdf: pdfPath, kb, verifyShot, track: JSON.parse(trackInfo.result.value) }));
ws.close();
process.exit(0);
