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
  nav.hidden = TRIPS.length < 2;            // טאבים רק כשיש יותר מנסיעה אחת
  TRIPS.forEach((t,i) => {
    const b = el("button", "", t.traveler || t.title);   // הטאב מציג את שם השליח
    b.setAttribute("role","tab");
    b.setAttribute("aria-selected", i === tripIndex);
    b.onclick = () => { tripIndex = i; location.hash = "trip" + (i+1); render(); };
    nav.appendChild(b);
  });
}

function renderPass(trip, steps, current){
  const approved = steps.filter(s => s.status === "אושר").length;
  document.getElementById("traveler").textContent = trip.traveler || "טרם הוזן שם";
  document.getElementById("destination").textContent = trip.destination || "טרם הוזן";
  document.getElementById("departure").textContent = fmtDate(trip.departure) || "—";
  document.getElementById("count").textContent = `${approved} / ${steps.length}`;
  document.getElementById("bar-fill").style.width = (steps.length ? approved / steps.length * 100 : 0) + "%";
  const next = document.getElementById("next");
  next.innerHTML = "";
  if(current < steps.length){
    const s = steps[current];
    next.append(el("span","lbl","השלב הבא"), el("strong","", s.role), el("span","lbl", s.round));
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
        el("span","date", fmtDate(s.date))
      );
      ul.appendChild(li); idx++;
    });
    sec.append(head, ul); wrap.appendChild(sec);
  });
}



// ===== טפסים למילוי =====
let formsDone = false;
function renderForms(){
  if(formsDone) return; formsDone = true;
  const sec = document.getElementById("forms-section"), ul = document.getElementById("forms-list");
  const list = (typeof FORMS !== "undefined" && Array.isArray(FORMS)) ? FORMS.filter(f => f && f.file) : [];
  const add = f => {
    const li = el("li");
    const a = el("a","form-link"); a.href = encodeURI(f.file); a.setAttribute("download", f.file);
    const ext = (f.file.split(".").pop() || "").toUpperCase();
    a.append(el("span","form-icon", ext === "PDF" ? "📄" : "📝"), el("span","form-title", f.title || f.file), el("span","form-ext", ext + " · הורדה ⬇"));
    li.appendChild(a);
    if(f.online){
      const o = el("a","form-online","✍️ מילוי מקוון"); o.href = encodeURI(f.online);
      li.appendChild(o);
    }
    if(f.note && String(f.note).trim()) li.appendChild(el("p","form-note", "⚠️ " + String(f.note).trim()));
    ul.appendChild(li); sec.hidden = false;
  };
  if(!location.protocol.startsWith("http")){ list.forEach(add); return; }
  list.forEach(f => fetch(encodeURI(f.file), { method: "HEAD", cache: "no-store" }).then(r => { if(r.ok) add(f); }).catch(() => {}));
}

function render(){
  const trip = TRIPS[tripIndex];
  const steps = flatten(trip);
  let current = steps.findIndex(s => s.status !== "אושר");
  if(current === -1) current = steps.length;      // הכול אושר – המטוס ביעד
  renderTabs();
  renderPass(trip, steps, current);
  renderMap(trip, steps, current);
  renderLegend(trip);
  renderForms();
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
  const name = info("שם השליח"), dest = info("יעד"), dep = info("תאריך יציאה");
  const trips = [];
  for(let k = 0; k < n; k++){
    const old = TRIPS[k] || {};
    const t = { title: (head[3 + 2*k] || `שליח ${k+1}`).replace(/\s*[–-]\s*סטטוס$/,""),
      traveler: name(k), destination: dest(k), departure: toISO(dep(k)),
      rounds: [] };
    let cur = null, last = "";
    rows.slice(hi + 1).forEach(r => {
      if(!r[2]) return;
      const rn = r[0] || last; last = rn;
      if(!cur || cur.name !== rn){ cur = { name: rn, color: PALETTE[t.rounds.length % PALETTE.length], steps: [] }; t.rounds.push(cur); }
      const st = (r[3 + 2*k] || "ממתין").trim();
      cur.steps.push({ role: r[2], status: STATUS[st] ? st : "ממתין", date: toISO(r[4 + 2*k]) });
    });
    trips.push(t);
  }
  if(!trips.length || !trips[0].rounds.length) throw new Error("empty");
  return trips;
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
window.addEventListener("hashchange", () => {
  const h = location.hash.match(/^#trip(\d+)$/);
  if(h && TRIPS[+h[1]-1] && +h[1]-1 !== tripIndex){ tripIndex = +h[1]-1; render(); }
});
render();
syncFromSheet();
