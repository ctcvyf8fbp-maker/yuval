// כלים משותפים: יצירת PDF מתמונות-עמודים ושיתוף בוואטסאפ (משמש את form-contact.html)
const PW = 1240, PH = 1754, FONT = 'Arial, "Arial Hebrew", "Noto Sans Hebrew", sans-serif';
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function newCanvas(){ const c = document.createElement("canvas"); c.width = PW; c.height = PH; c.setAttribute("dir","rtl");
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, PW, PH); try{ x.direction = "rtl"; }catch(e){} return [c, x]; }
// דפים פשוטים (לטפסים בלי טופס מקורי)
function pager(){
  const M = 90, out = []; let c, x, y;
  const page = () => { [c, x] = newCanvas(); out.push(c); y = M; x.fillStyle = "#111"; x.textAlign = "right"; x.direction = "rtl"; };
  page();
  const lines = (text, font, maxW) => { x.font = font; const words = String(text).split(/\s+/); const res = []; let cur = "";
    words.forEach(w => { const t = cur ? cur + " " + w : w; if(x.measureText(t).width > maxW && cur){ res.push(cur); cur = w; } else cur = t; });
    if(cur) res.push(cur); return res.length ? res : [""]; };
  const write = (text, size, opt = {}) => {
    const font = `${opt.bold ? "bold " : ""}${size}px ${FONT}`, lh = size * 1.45;
    String(text).split("\n").forEach(par => lines(par, font, PW - 2 * M - (opt.indent || 0)).forEach(l => {
      if(y + lh > PH - M) page();
      x.font = font; x.fillStyle = opt.color || "#111"; x.textAlign = opt.center ? "center" : "right";
      x.fillText(l, opt.center ? PW / 2 : PW - M - (opt.indent || 0), y + size); y += lh;
    }));
  };
  return {
    title(t){ write(t, 40, { bold: true, center: true }); y += 14; },
    sub(t){ write(t, 22, { center: true, color: "#555" }); y += 10; },
    h(t){ y += 18; if(y + 60 > PH - M) page(); write(t, 28, { bold: true }); x.fillStyle = "#999"; x.fillRect(M, y + 2, PW - 2 * M, 2); y += 14; },
    h4(t){ y += 8; write(t, 25, { bold: true }); },
    kv(k, v){ write(k + ": " + (v === "" || v == null ? "—" : v), 24); y += 4; },
    p(t, indent){ write(t, 23, { indent: indent ? 30 : 0 }); y += 6; },
    async img(src, maxH = 520){ const i = await loadImg(src); if(!i) return; const r = Math.min((PW - 2 * M) / i.width, maxH / i.height, 1.5); const w = i.width * r, h = i.height * r;
      if(y + h > PH - M) page(); x.drawImage(i, PW - M - w, y, w, h); y += h + 12; },
    done(){ return out; }
  };
}
let jsPDFp = null;
const loadJsPDF = () => jsPDFp || (jsPDFp = new Promise((res, rej) => { if(window.jspdf) return res();
  const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; s.onload = res; s.onerror = rej; document.head.append(s); }));
function download(file){ const u = URL.createObjectURL(file); const a = document.createElement("a"); a.href = u; a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }

async function canvasesToFile(canv, name){
  await loadJsPDF();
  const pdf = new window.jspdf.jsPDF({ unit: "pt", format: "a4", compress: true });
  canv.forEach((c, i) => { if(i) pdf.addPage(); pdf.addImage(c.toDataURL("image/jpeg", 0.82), "JPEG", 0, 0, 595.28, 841.89); });
  return new File([pdf.output("blob")], name.replace(/[\\/:*?"<>|]/g, "") + ".pdf", { type: "application/pdf" });
}
async function shareFileWA(file, title){
  if(navigator.canShare && navigator.canShare({ files: [file] })){ await navigator.share({ files: [file], title: file.name, text: title }); return; }
  download(file);
  const num = (typeof WHATSAPP_NUMBER === "string" ? WHATSAPP_NUMBER : "").replace(/\D/g, "").replace(/^0/, "972");
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(`מצרף/ת את „${title}” (הקובץ ירד עכשיו למחשב – יש לצרף אותו כאן 📎)`)}`, "_blank", "noopener");
}
