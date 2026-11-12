// ===== הלוגיקה של האתר – בדרך כלל אין צורך לשנות כאן =====
const NS = "http://www.w3.org/2000/svg";
const STATUS = {
  "אושר":   { cls: "ok",      text: "✔ אושר" },
  "בטיפול": { cls: "wait",    text: "⏳ בטיפול" },
  "נדחה":   { cls: "no",      text: "✖ נדחה" },
  "ממתין":  { cls: "pending", text: "ממתין" }
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let tripIndex = 0, animId = null;

function fmtDate(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
function svg(tag, attrs){
  const e = document.createElementNS(NS, tag);
  for(const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// כל השלבים ברצף אחד, עם צבע הסבב
function flatten(trip){
  const out = [];
  trip.rounds.forEach(r => r.steps.forEach(s => out.push({ ...s, color: r.color, round: r.name })));
  return out;
}

function renderTabs(){
  const nav = document.getElementById("tabs");
  nav.innerHTML = "";
  nav.setAttribute("role","tablist");
  nav.hidden = false;
  TRIPS.forEach((t,i) => {
    const b = el("button", "", /^שליח \d+$/.test(t.title || "") ? (t.traveler || t.title) : t.title);
    b.setAttribute("role","tab");
    b.setAttribute("aria-selected", view === "trip" && i === tripIndex);
    b.onclick = () => { view = "trip"; tripIndex = i; location.hash = "trip" + (i+1); render(); };
    nav.appendChild(b);
  });
  specialTabs.forEach(s => {
    const ib = el("button", "info-tab", ({ info: "📚 ", forms: "📝 ", checklist: "✅ " }[s.kind] || "") + s.label);
    ib.setAttribute("role","tab");
    ib.setAttribute("aria-selected", view === s.kind);
    ib.onclick = () => { view = s.kind; location.hash = s.kind; render(); window.scrollTo(0,0); };
    nav.appendChild(ib);
  });
}

function renderPass(trip, steps, current){
  const approved = steps.filter(s => s.status === "אושר").length;
  document.getElementById("traveler").textContent = trip.traveler || "טרם הוזן שם";
  document.getElementById("destination").textContent = trip.destination || "טרם הוזן";
  document.getElementById("departure").textContent = fmtDate(trip.departure) || "—";
  const cd = document.getElementById("countdown");
  if(trip.departure && /^\d{4}-\d{2}-\d{2}$/.test(trip.departure)){
    const d = daysBetween(todayISO(), trip.departure);
    cd.hidden = false;
    cd.textContent = d > 1 ? `✈ עוד ${d} ימים ליציאה` : d === 1 ? "✈ מחר יוצאים!" : d === 0 ? "✈ היום יוצאים!" : `יצא/ה לפני ${-d} ימים`;
    cd.className = "countdown" + (d >= 0 && d <= 14 ? " soon" : "");
  } else cd.hidden = true;
  document.getElementById("count").textContent = `${approved} / ${steps.length}`;
  document.getElementById("bar-fill").style.width = (steps.length ? approved / steps.length * 100 : 0) + "%";
  const next = document.getElementById("next");
  next.innerHTML = "";
  if(!steps.length){
    next.append(el("strong","", "עוד לא הוגדרו אישורים ללשונית הזו"));
  } else if(current < steps.length){
    const s = steps[current];
    next.append(el("span","lbl","השלב הבא"), el("strong","", s.role), el("span","lbl", s.round));
    if(s.date){ const w = daysBetween(s.date, todayISO()); if(w >= 0) next.append(el("span","wait-days" + (w > OVERDUE() ? " late" : ""), `⏳ ממתין ${w} ימים`)); }
  } else {
    next.append(el("strong","", "✈ כל האישורים התקבלו – אפשר לצאת!"));
  }
}

function renderMap(trip, steps, current){
  const map = document.getElementById("map");
  [...map.querySelectorAll(":scope > :not(desc)")].forEach(n => n.remove());
  const W = 1000, H = 240, pad = 60, mid = 120, amp = 55;
  const n = steps.length + 2;                       // התחלה + שלבים + יעד
  const stepX = (W - pad*2) / (n - 1);
  const pts = Array.from({length:n}, (_,i) => ({ x: W - pad - i*stepX, y: mid + amp*Math.sin(i*1.05) }));

  // מסלול חלק (Catmull-Rom)
  const segs = [];
  for(let i=0;i<n-1;i++){
    const p0 = pts[Math.max(i-1,0)], p1 = pts[i], p2 = pts[i+1], p3 = pts[Math.min(i+2,n-1)];
    const c1 = { x: p1.x + (p2.x-p0.x)/6, y: p1.y + (p2.y-p0.y)/6 };
    const c2 = { x: p2.x - (p3.x-p1.x)/6, y: p2.y - (p3.y-p1.y)/6 };
    segs.push(`C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`);
  }
  const d = `M${pts[0].x},${pts[0].y} ` + segs.join(" ");

  // אורך מצטבר עד כל נקודה
  const cum = [0];
  for(let i=0;i<n-1;i++){
    const t = svg("path",{d:`M${pts[i].x},${pts[i].y} ${segs[i]}`});
    map.appendChild(t); cum.push(cum[i] + t.getTotalLength()); t.remove();
  }
  const target = cum[current + 1];                  // הנקודה של השלב הנוכחי

  const base = svg("path",{d, fill:"none", stroke:"var(--runway)", "stroke-width":3, "stroke-dasharray":"2 9", "stroke-linecap":"round"});
  const flown = svg("path",{d, fill:"none", stroke:"var(--ok)", "stroke-width":4, "stroke-linecap":"round"});
  map.append(base, flown);
  const total = flown.getTotalLength();
  flown.setAttribute("stroke-dasharray", `0 ${total}`);

  // תוויות התחלה ויעד
  const lab = (p, txt, anchorDy) => {
    const t = svg("text",{x:p.x, y:p.y + anchorDy, "text-anchor":"middle", "font-size":15, "font-weight":700});
    t.textContent = txt; map.appendChild(t);
  };
  map.appendChild(svg("circle",{cx:pts[0].x, cy:pts[0].y, r:6, fill:"var(--ink)"}));
  lab(pts[0], "התחלה", 28);
  const end = pts[n-1];
  map.appendChild(svg("rect",{x:end.x-9, y:end.y-9, width:18, height:18, rx:4, fill:"var(--ink)"}));
  lab(end, trip.destination || "יעד", 32);

  // נקודות האישורים
  steps.forEach((s,i) => {
    const p = pts[i+1], g = svg("g",{class:"wp"});
    const ok = s.status === "אושר", no = s.status === "נדחה";
    if(i === current) g.appendChild(svg("circle",{cx:p.x, cy:p.y, r:17, fill:"none", stroke:"var(--amber)", "stroke-width":3}));
    g.appendChild(svg("circle",{cx:p.x, cy:p.y, r:11,
      fill: ok ? s.color : no ? "var(--no)" : "var(--paper)", stroke: no ? "var(--no)" : s.color, "stroke-width":3}));
    const num = svg("text",{x:p.x, y:p.y+4, "text-anchor":"middle", "font-size":11, "font-weight":700,
      style:`fill:${ok||no ? "#fff" : s.color}`});
    num.textContent = i+1; g.appendChild(num);
    const tip = svg("title",{}); tip.textContent = `${i+1}. ${s.role} · ${s.status}`;
    g.appendChild(tip);
    map.appendChild(g);
  });

  // המטוס
  const plane = svg("g",{});
  plane.appendChild(svg("path",{
    d:"M20,0 C20,-2 17,-3 12,-3 L3,-3 L-6,-18 L-11,-18 L-6,-3 L-14,-3 L-18,-9 L-22,-9 L-19,0 L-22,9 L-18,9 L-14,3 L-6,3 L-11,18 L-6,18 L3,3 L12,3 C17,3 20,2 20,0 Z",
    fill:"var(--ink)", stroke:"var(--paper)", "stroke-width":1.5}));
  map.appendChild(plane);

  const place = (l) => {
    const a = flown.getPointAtLength(Math.max(l,0));
    const b = flown.getPointAtLength(Math.min(l+1,total));
    const ang = Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI;
    plane.setAttribute("transform", `translate(${a.x},${a.y - 26}) rotate(${ang})`);
    flown.setAttribute("stroke-dasharray", `${l} ${total}`);
  };

  cancelAnimationFrame(animId);
  if(reduceMotion){ place(target); return; }
  const dur = 1800, t0 = performance.now();
  const tick = (now) => {
    const k = Math.min((now - t0)/dur, 1), e = 1 - Math.pow(1-k, 3);
    place(target * e);
    if(k < 1) animId = requestAnimationFrame(tick);
  };
  animId = requestAnimationFrame(tick);
}

function renderLegend(trip){
  const ul = document.getElementById("legend"); ul.innerHTML = "";
  trip.rounds.forEach(r => {
    const li = el("li"); const i = el("i"); i.style.background = r.color;
    li.append(i, r.name); ul.appendChild(li);
  });
}

function renderRounds(trip, current){
  const wrap = document.getElementById("rounds"); wrap.innerHTML = "";
  let idx = 0;
  trip.rounds.forEach(r => {
    const sec = el("section","round"); sec.style.setProperty("--rc", r.color);
    const ok = r.steps.filter(s => s.status === "אושר").length;
    const head = el("div","round-head");
    head.append(el("h2","",r.name), el("span","sum",`${ok} מתוך ${r.steps.length} אושרו`));
    if(ok === r.steps.length) head.append(el("span","done","✔ הסבב הושלם"));
    const ul = el("ol","steps");
    r.steps.forEach((s,k) => {
      const st = STATUS[s.status] || STATUS["ממתין"];
      const li = el("li","step" + (s.status==="אושר" ? " ok" : "") + (idx===current ? " current" : ""));
      li.append(
        el("span","num", k+1),
        el("span","role", s.role),
        el("span","chip " + st.cls, st.text),
        el("span","date", s.status === "אושר" ? fmtDate(s.date) : (s.date ? "נשלח " + fmtDate(s.date) : ""))
      );
      if(s.status !== "אושר" && s.date){
        const w = daysBetween(s.date, todayISO());
        if(w > OVERDUE()){ li.classList.add("late"); li.querySelector(".role").append(el("span","late-tag", ` ⚠ ממתין ${w} ימים`)); }
      }
      ul.appendChild(li); idx++;
    });
    sec.append(head, ul); wrap.appendChild(sec);
  });
}




// ===== עזרים: מעקב מסמכים, ימים =====
const docWords = () => (typeof DOC_ROWS_WORDS !== "undefined" && Array.isArray(DOC_ROWS_WORDS)) ? DOC_ROWS_WORDS : ["מסמכים"];
const norm = s => String(s || "").replace(/["'״׳–\-\s]/g, "");
function docStatus(trip, title){
  const docs = (trip && trip.docs) || {}; const keys = Object.keys(docs);
  if(!keys.length) return null;
  const n = norm(title);
  const k = keys.find(k => { const m = norm(k); return m && (n.includes(m) || m.includes(n)); });
  if(k === undefined) return null;
  const v = docs[k];
  if(/^(התקבל|התקבלו|אושר|הושלם|✓|v|כן)$/i.test(v)) return "ok";
  if(/^(בטיפול|בתהליך)$/.test(v)) return "wait";
  return "missing";
}
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const OVERDUE = () => (typeof OVERDUE_DAYS === "number" ? OVERDUE_DAYS : 7);

// ===== טפסים למילוי =====
const fileOk = {};   // תוצאות בדיקה אם קובץ ההורדה קיים
function renderForms(trip){
  const sec = document.getElementById("forms-section"), ul = document.getElementById("forms-list");
  const list = (typeof FORMS !== "undefined" && Array.isArray(FORMS)) ? FORMS.filter(f => f && f.title) : [];
  // לאן שולחים: התיקייה האישית של השליח ב-OneDrive, ואם אין – הקישור הכללי
  const folder = (trip && trip.folder ? String(trip.folder) : "").trim();
  const up = folder || (typeof UPLOAD_LINK === "string" ? UPLOAD_LINK : "").trim();
  const online = location.protocol.startsWith("http");
  ul.innerHTML = "";
  let tracked = 0, got = 0;
  const box = document.getElementById("my-folder");
  box.innerHTML = ""; box.hidden = !folder;
  if(folder){
    const a = el("a","fbtn primary","📁 התיקייה האישית שלי"); a.href = folder; a.target = "_blank"; a.rel = "noopener";
    box.append(a, el("span","folder-hint", "כאן מעלים את כל המסמכים. רק את/ה ומנהלת המעקב רואים אותה."));
  }
  list.forEach((f, i) => {
    const li = el("li","form-card");
    const head = el("div","form-head");
    head.append(el("span","form-num", i + 1), el("span","form-title", f.title));
    const ds = docStatus(trip, f.title);
    if(ds){ tracked++; if(ds === "ok") got++;
      head.append(el("span","doc-badge " + ds, ds === "ok" ? "✓ התקבל" : ds === "wait" ? "⏳ בטיפול" : "חסר")); li.classList.add("ds-" + ds); }
    li.append(head);
    const acts = el("div","form-acts");
    if(f.online){
      const o = el("a","fbtn primary","✍️ מילוי מקוון");
      o.href = f.online + (up ? (f.online.includes("?") ? "&" : "?") + "up=" + encodeURIComponent(up) : "");
      acts.append(o);
    }
    if(f.file){
      const d = el("a","fbtn","⬇ הורדה"); d.href = encodeURI(f.file); d.setAttribute("download", f.file);
      if(online){
        if(fileOk[f.file] === undefined){ d.hidden = true;
          fetch(encodeURI(f.file), { method: "HEAD", cache: "no-store" }).then(r => { fileOk[f.file] = r.ok; d.hidden = !r.ok; }).catch(() => {}); }
        else d.hidden = !fileOk[f.file];
      }
      acts.append(d);
    }
    if(f.upload && up){ const u = el("a","fbtn primary","📤 העלאת קובץ"); u.href = up; u.target = "_blank"; u.rel = "noopener"; acts.append(u); }
    li.append(acts);
    if(f.note && String(f.note).trim()) li.append(el("p","form-note", "⚠️ " + String(f.note).trim()));
    ul.append(li);
  });
  sec.hidden = !list.length;
  const sum = document.getElementById("docs-summary");
  sum.hidden = !tracked;
  if(tracked) sum.innerHTML = `<strong>התקבלו ${got} מתוך ${tracked} מסמכים</strong>` + (trip.traveler ? ` · ${esc(trip.traveler)}` : "") + (got === tracked ? " · ✓ הכול הגיע!" : "");
}
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

// ===== מידע, זכויות וצ׳ק ליסט (רק בלשוניות שליחות) =====
const isMission = trip => {
  const words = (typeof NO_DOCS_TITLES !== "undefined" && Array.isArray(NO_DOCS_TITLES)) ? NO_DOCS_TITLES : [];
  const txt = (trip.title || "") + " " + (trip.traveler || "");
  return !words.some(w => w && txt.includes(w));
};
let infoDone = false;
function renderInfo(){
  if(infoDone) return; infoDone = true;
  const box = document.getElementById("info-list");
  (typeof INFO !== "undefined" ? INFO : []).forEach(it => {
    const a = el("a","info-card"); a.href = it.file ? encodeURI(it.file) : it.link;
    if(it.file) a.setAttribute("download", it.file); else { a.target = "_blank"; a.rel = "noopener"; }
    a.append(el("span","info-icon", it.icon || "📄"), el("span","info-title", it.title), el("span","info-sub", (it.sub ? it.sub + " · " : "") + (it.file ? "הורדה ⬇" : "מעבר לאתר ↗")));
    box.append(a);
  });
  const nl = document.getElementById("notes-list");
  (typeof INFO_NOTES !== "undefined" ? INFO_NOTES : []).forEach(n => {
    const c = el("div","note-card"); c.append(el("h3","", (n.icon ? n.icon + " " : "") + n.title));
    (n.before || []).forEach(t => c.append(el("p","",t)));
    if(n.ol){ const ol = el("ol"); n.ol.forEach(t => ol.append(el("li","",t))); c.append(ol); }
    (n.after || []).forEach(t => c.append(el("p","",t)));
    nl.append(c);
  });
  const rl = document.getElementById("rights-list");
  (typeof RIGHTS !== "undefined" ? RIGHTS : []).forEach(r => {
    const c = el("div","right-card"); c.append(el("h3","", (r.icon ? r.icon + " " : "") + r.title));
    const ul = el("ul"); r.items.forEach(t => ul.append(el("li","",t))); c.append(ul); rl.append(c);
  });
}
function clLoad(){ try{ return JSON.parse(localStorage.getItem(CHECKLIST_KEY) || "[]"); }catch(e){ return []; } }
function clSave(v){ try{ localStorage.setItem(CHECKLIST_KEY, JSON.stringify(v)); }catch(e){} }
let clDone = false;
function renderChecklist(){
  if(typeof CHECKLIST === "undefined") return;
  const all = CHECKLIST.flatMap(g => g.items.map(i => i.title));
  const upd = () => {
    const done = clLoad().filter(t => all.includes(t)).length;
    document.getElementById("cl-count").textContent = `${done} / ${all.length} הושלמו`;
    document.getElementById("cl-bar").style.width = (all.length ? done / all.length * 100 : 0) + "%";
  };
  if(!clDone){
    clDone = true;
    const box = document.getElementById("cl-list");
    CHECKLIST.forEach(g => {
      const sec = el("div","cl-group"); sec.append(el("h3","",g.group));
      g.items.forEach(it => {
        const lab = el("label","cl-item"); const cb = el("input"); cb.type = "checkbox";
        cb.checked = clLoad().includes(it.title);
        cb.onchange = () => { const v = new Set(clLoad()); cb.checked ? v.add(it.title) : v.delete(it.title); clSave([...v]); lab.classList.toggle("on", cb.checked); upd(); };
        lab.classList.toggle("on", cb.checked);
        const txt = el("span","cl-text"); txt.append(el("strong","",it.title), el("span","cl-detail",it.detail || ""));
        if(it.contact) txt.append(el("span","cl-contact","📞 " + it.contact));
        lab.append(cb, txt); sec.append(lab);
      });
      box.append(sec);
    });
  }
  upd();
}
function renderMission(trip, up){
  // מסמכים וטפסים – רק בלשוניות שליחות (לא באוריינטציה)
  if(!isMission(trip)) document.getElementById("forms-section").hidden = true;
}
function renderInfoView(){
  renderChecklist();
  const mt = TRIPS.find(isMission) || TRIPS[0] || {};
  const st = docStatus(mt, "צ׳ק ליסט");
  const b = document.getElementById("cl-status");
  b.hidden = !st;
  if(st) { b.className = "cl-status " + st; b.textContent = "סטטוס אצל מנהלת המעקב: " + (st === "ok" ? "✓ הצ׳ק ליסט הושלם ואושר" : st === "wait" ? "⏳ בבדיקה" : "עוד לא התקבל אישור סיום"); }
  // השליחה מהצ׳ק ליסט: לתיקייה של לשונית השליחות הראשונה, ואם אין – לקישור הכללי
  const t = TRIPS.find(isMission) || TRIPS[0] || {};
  const up = ((t.folder || "") + "").trim() || (typeof UPLOAD_LINK === "string" ? UPLOAD_LINK : "").trim();
  document.getElementById("cl-sign").href = "form.html?f=checklist" + (up ? "&up=" + encodeURIComponent(up) : "");
}

// לשוניות מיוחדות: "forms" = מסמכים וטפסים, "info" = מידע וצ׳ק ליסט (בלי סבב אישורים)
let specialTabs = [{ kind: "forms", label: "טפסים למילוי" }, { kind: "info", label: "מידע לשליח" }, { kind: "checklist", label: "צ׳ק ליסט לשליח" }];
function specialKind(title){
  title = title || "";
  const fw = (typeof FORMS_TAB_WORDS !== "undefined" && Array.isArray(FORMS_TAB_WORDS)) ? FORMS_TAB_WORDS : ["טפסים"];
  const iw = (typeof INFO_TAB_WORDS !== "undefined" && Array.isArray(INFO_TAB_WORDS)) ? INFO_TAB_WORDS : ["מידע"];
  const cw = (typeof CHECKLIST_TAB_WORDS !== "undefined" && Array.isArray(CHECKLIST_TAB_WORDS)) ? CHECKLIST_TAB_WORDS : ["ליסט"];
  if(fw.some(x => x && title.includes(x))) return "forms";
  if(cw.some(x => x && title.includes(x))) return "checklist";
  if(iw.some(x => x && title.includes(x))) return "info";
  return "";
}
let view = "trip";   // "trip" = לשונית שליח/נסיעה, "info" = מידע וצ׳ק ליסט
function render(){
  const isInfo = view === "info", isForms = view === "forms", isCL = view === "checklist";
  const special = isInfo || isForms || isCL;
  document.querySelectorAll(".trip-only").forEach(s => s.hidden = special);
  document.getElementById("info-section").hidden = !isInfo;
  document.getElementById("rights-section").hidden = !isInfo;
  document.getElementById("checklist-section").hidden = !isCL;
  const fsec = document.getElementById("forms-section");
  const after = document.getElementById("after-trip");
  after.hidden = true;
  if(special){
    renderTabs();
    if(isInfo) renderInfo();
    else if(isCL) renderInfoView();
    else renderForms(TRIPS.find(isMission) || TRIPS[0] || {});
    fsec.hidden = !isForms;
    const st = (typeof SITE_TITLE === "string" && SITE_TITLE.trim()) ? SITE_TITLE.trim() : "מעקב אישורים";
    document.getElementById("site-title").textContent = st;
    const lab = (specialTabs.find(s => s.kind === view) || {}).label || "";
    document.title = `${lab} – ${st}`;
    return;
  }
  fsec.hidden = true;
  const trip = TRIPS[tripIndex];
  const steps = flatten(trip);
  const empty = !steps.length;
  document.querySelector(".map-wrap").hidden = empty;
  document.getElementById("empty-note").hidden = !empty;
  let current = steps.findIndex(s => s.status !== "אושר");
  if(current === -1) current = steps.length;      // הכול אושר – המטוס ביעד
  renderTabs();
  renderPass(trip, steps, current);
  renderMap(trip, steps, current);
  renderLegend(trip);
  if(!isMission(trip)){
    after.hidden = false;
    const up = ((trip.folder || "") + "").trim() || (typeof UPLOAD_LINK === "string" ? UPLOAD_LINK : "").trim();
    document.getElementById("settle-online").href = "form.html?f=settlement" + (up ? "&up=" + encodeURIComponent(up) : "");
  }
  renderMission(trip, ((trip.folder || "") + "").trim() || (typeof UPLOAD_LINK === "string" ? UPLOAD_LINK : "").trim());
  renderRounds(trip, current);
  document.getElementById("updated").textContent = fmtDate(LAST_UPDATED);
  const st = (typeof SITE_TITLE === "string" && SITE_TITLE.trim()) ? SITE_TITLE.trim() : "מעקב אישורים";
  document.getElementById("site-title").textContent = st;
  document.title = `${trip.traveler || trip.title} – ${st}`;
}


// ===== סנכרון עם Google Sheets =====
const PALETTE = ["#2E5597","#0F7C7A","#6A3D9A","#B5531F","#2E7D32"];
function parseCSV(text){
  const rows = []; let row = [], cell = "", q = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(q){
      if(ch === '"'){ if(text[i+1] === '"'){ cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if(ch === '"') q = true;
    else if(ch === ","){ row.push(cell); cell = ""; }
    else if(ch === "\n" || ch === "\r"){
      if(ch === "\r" && text[i+1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if(cell !== "" || row.length){ row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}
function toISO(v){
  v = (v || "").trim(); if(!v) return "";
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if(m){ const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  return "";
}
function tripsFromSheet(rows){
  const hi = rows.findIndex(r => r[0] === "סבב");
  if(hi < 0) throw new Error("no header");
  const head = rows[hi];
  const n = Math.floor((head.length - 3) / 2);
  const info = label => { const r = rows.slice(0, hi).find(r => r[0] === label); return k => r ? (r[3 + 2*k] || "") : ""; };
  const name = info("שם השליח"), dest = info("יעד"), dep = info("תאריך יציאה"), folder = info("תיקיית מסמכים");
  const trips = [];
  for(let k = 0; k < n; k++){
    const old = TRIPS[k] || {};
    const t = { title: (head[3 + 2*k] || `שליח ${k+1}`).replace(/\s*[–-]\s*סטטוס$/,""),
      traveler: name(k), destination: dest(k), departure: toISO(dep(k)), folder: folder(k),
      rounds: [], docs: {} };
    let cur = null, last = "";
    rows.slice(hi + 1).forEach(r => {
      if(!r[2]) return;
      const rn = r[0] || last; last = rn;
      // שורות „מסמכים” – מעקב קבלת מסמכים (לא סבב אישורים)
      if(docWords().some(w => rn.includes(w))){ t.docs[r[2]] = (r[3 + 2*k] || "").trim(); return; }
      // תא ריק = „ממתין”. כדי שאישור לא יופיע בלשונית מסוימת – כותבים בתא שלה „-” או „לא רלוונטי”
      const st = (r[3 + 2*k] || "").trim() || "ממתין";
      if(/^[-–—]$/.test(st) || st === "לא רלוונטי") return;
      if(!cur || cur.name !== rn){ cur = { name: rn, color: PALETTE[t.rounds.length % PALETTE.length], steps: [] }; t.rounds.push(cur); }
      cur.steps.push({ role: r[2], status: STATUS[st] ? st : "ממתין", date: toISO(r[4 + 2*k]) });
    });
    trips.push(t);
  }
  // עמודה בגיליון שהכותרת שלה כוללת „מידע” – היא לא שליח: היא לשונית המידע והצ׳ק ליסט
  const special = [];
  trips.forEach(t => { const k = specialKind(t.title); if(k) special.push({ kind: k, label: t.title }); });
  // לשוניות מגיליון קובעות שם וסדר; לשונית שאין לה עמודה בגיליון מופיעה בכל זאת בסוף
  const defaults = [{ kind: "forms", label: "טפסים למילוי" }, { kind: "info", label: "מידע לשליח" }, { kind: "checklist", label: "צ׳ק ליסט לשליח" }];
  specialTabs = special.concat(defaults.filter(d => !special.some(s => s.kind === d.kind)));
  const real = trips.filter(t => !specialKind(t.title));
  if(!real.length || !real.some(t => t.rounds.length)) throw new Error("empty");
  return real;
}
function syncFromSheet(){
  const url = (typeof SHEET_CSV_URL === "string" ? SHEET_CSV_URL : "").trim();
  if(!url) return;
  const state = document.getElementById("sync-state");
  state.textContent = "· טוען מהגיליון…";
  fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store" })
    .then(r => { if(!r.ok) throw new Error(r.status); return r.text(); })
    .then(txt => {
      const trips = tripsFromSheet(parseCSV(txt));
      TRIPS.splice(0, TRIPS.length, ...trips);
      if(tripIndex >= TRIPS.length) tripIndex = 0;
      document.getElementById("updated-wrap").hidden = true;
      const now = new Date();
      state.textContent = "✔ מסונכרן עם הגיליון · נטען ב-" + now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
      render();
    })
    .catch(() => { state.textContent = "· לא הצלחתי לטעון את הגיליון – מוצגים הנתונים השמורים"; });
}

// פתיחה לפי #trip2 בכתובת
const m = location.hash.match(/^#trip(\d+)$/);
if(m && TRIPS[+m[1]-1]) tripIndex = +m[1]-1;
if(location.hash === "#info") view = "info";
if(location.hash === "#forms") view = "forms";
if(location.hash === "#checklist") view = "checklist";
window.addEventListener("hashchange", () => {
  const h = location.hash.match(/^#trip(\d+)$/);
  const k = location.hash.slice(1);
  if((k === "info" || k === "forms" || k === "checklist") && view !== k){ view = k; render(); }
  else if(h && TRIPS[+h[1]-1] && (+h[1]-1 !== tripIndex || view !== "trip")){ view = "trip"; tripIndex = +h[1]-1; render(); }
});
render();
syncFromSheet();
