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
  document.getElementById("departure-lbl").textContent = isMission(trip) ? "יציאה לשליחות" : "יציאה לאוריינטציה";
  document.getElementById("marital").textContent = trip.marital || "—";
  const sp = (trip.spouse || "").trim();
  document.getElementById("f-spouse").hidden = !sp;
  document.getElementById("spouse").textContent = /^(כן|v|✓)$/i.test(sp) ? "יוצא/ת עם בן/בת הזוג" : /^לא$/.test(sp) ? "יוצא/ת לבד" : sp;
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

// ===== חיפוש במידע לשליח =====
const STOP = new Set("של את על עם מה כמה איך אני יש לי לו לה האם זה זו או גם אם כל לא הוא היא מי למה מתי איפה אפשר צריך מותר שלי שלנו אנחנו אתם הם הן כן רק עד אחרי לפני בין כי אז the".split(" "));
const PREF = /^(ו?(ש|כש|מש|לכש)?(ה|ב|ל|מ|כ)?)/;
function nrm(s){ return String(s || "").replace(/[\u0591-\u05C7]/g, "").replace(/["'״׳`]/g, "").replace(/[^\u05D0-\u05EAa-zA-Z0-9]+/g, " ").toLowerCase().trim(); }
function stem(w){
  let s = w;
  if(/^[\u05D0-\u05EA]/.test(s) && s.length > 3){ const m = s.match(PREF); if(m && m[0] && s.length - m[0].length >= 2) s = s.slice(m[0].length); }
  if(s.length > 4) s = s.replace(/(ים|ות|יות|ה|ת)$/, "");
  return s;
}
const toks = s => nrm(s).split(" ").filter(Boolean);
let SIDX = null, bookletLoading = null;
function loadBooklet(){
  if(typeof BOOKLET !== "undefined") return Promise.resolve();
  if(!bookletLoading) bookletLoading = new Promise(res => { const sc = document.createElement("script"); sc.src = "booklet-index.js"; sc.onload = res; sc.onerror = res; document.head.append(sc); });
  return bookletLoading;
}
function buildIndex(){
  const docs = [];
  const add = (src, title, text, link) => docs.push({ src, title, text, link });
  (typeof RIGHTS !== "undefined" ? RIGHTS : []).forEach(r => add("הזכויות שלך", r.title, r.items.join(" "), "#info"));
  (typeof INFO_NOTES !== "undefined" ? INFO_NOTES : []).forEach(n => add("מידע לשליח", n.title, [...(n.before||[]), ...(n.ol||[]), ...(n.after||[])].join(" "), "#info"));
  (typeof ORIENT_NOTES !== "undefined" ? ORIENT_NOTES : []).forEach(n => add("אוריינטציה", n.title, [ORIENT_NOTE || "", ...(n.before||[]), ...(n.ol||[])].join(" "), ""));
  (typeof CHECKLIST !== "undefined" ? CHECKLIST : []).forEach(g => g.items.forEach(i => add("צ׳ק ליסט", i.title, (i.detail || "") + (i.contact ? " · " + i.contact : ""), "#checklist")));
  const after = document.getElementById("after-trip");
  if(after) after.querySelectorAll(".after-list > li").forEach(li => add("אחרי הנסיעה – התחשבנות", li.querySelector("strong") ? li.querySelector("strong").textContent : "", li.textContent.replace(/✍️ מילוי מקוון|⬇ הורדה/g, ""), ""));
  (typeof FORMS !== "undefined" ? FORMS : []).forEach(f => add("טפסים למילוי", f.title, f.note || "", "#forms"));
  (typeof BOOKLET !== "undefined" ? BOOKLET : []).forEach(b => add("חוברת ההכנה לשליחות", "עמוד " + b.p + " בקובץ", b.t, "booklet-2022.pdf#page=" + b.p));
  docs.forEach(d => { d.stems = toks(d.title + " " + d.text).map(stem); d.tstems = new Set(toks(d.title).map(stem)); });
  const df = {}; docs.forEach(d => new Set(d.stems).forEach(s => df[s] = (df[s] || 0) + 1));
  SIDX = { docs, df, N: docs.length };
}
function search(q){
  const terms = [...new Set(toks(q).filter(w => !STOP.has(w)).map(stem).filter(s => s.length >= 2))];
  if(!terms.length) return [];
  const { docs, df, N } = SIDX;
  const res = [], keys = Object.keys(df);
  const idf = Object.fromEntries(terms.map(t => [t, Math.log(1 + N / (1 + keys.filter(k => k.startsWith(t)).reduce((a, k) => a + df[k], 0)))]));
  docs.forEach(d => {
    let score = 0, hit = 0;
    terms.forEach(t => {
      const n = d.stems.filter(s => s.startsWith(t)).length;
      if(n){ hit++; score += idf[t] * (1 + Math.log(n)) + ([...d.tstems].some(s => s.startsWith(t)) ? 2 : 0); }
    });
    if(hit){ score *= hit / terms.length; if(d.src !== "חוברת ההכנה לשליחות") score *= 1.25; res.push({ d, score, hit }); }
  });
  res.sort((a, b) => b.hit - a.hit || b.score - a.score);
  return { terms, res: res.slice(0, 8) };
}
function snippet(text, terms){
  const parts = text.split(/(?<=[.:;!?])\s+/);
  let best = parts[0] || text, bs = -1;
  parts.forEach(p => { const st = toks(p).map(stem); const s = terms.filter(t => st.some(x => x.startsWith(t))).length; if(s > bs){ bs = s; best = p; } });
  if(best.length > 320) best = best.slice(0, 320) + "…";
  // הדגשה
  return esc(best).replace(/[\u05D0-\u05EAa-zA-Z0-9"״׳']+/g, w => terms.some(t => stem(nrm(w)).startsWith(t)) ? `<mark>${w}</mark>` : w);
}
async function runSearch(){
  const q = document.getElementById("q").value.trim();
  const box = document.getElementById("q-results");
  if(!q){ box.innerHTML = ""; return; }
  box.innerHTML = `<p class="search-hint">מחפש…</p>`;
  await loadBooklet();
  if(!SIDX || (typeof BOOKLET !== "undefined" && !SIDX.docs.some(d => d.src === "חוברת ההכנה לשליחות"))) buildIndex();
  const r = search(q);
  if(!r.res || !r.res.length){ box.innerHTML = `<p class="no-res">לא נמצאו תוצאות. נסו מילים אחרות, או בדקו בהוראות התכ״ם.</p>`; return; }
  box.innerHTML = r.res.map(({ d }) => `<article class="res">
      <div class="res-src">${esc(d.src)}${d.title ? " · " + esc(d.title) : ""}</div>
      <p>${snippet(d.text, r.terms)}</p>
      ${d.link ? `<a class="res-link" href="${esc(d.link)}"${d.link.startsWith("#") ? "" : ' target="_blank" rel="noopener"'}>${d.link.startsWith("booklet") ? "פתיחת החוברת בעמוד הזה ↗" : "מעבר ללשונית ←"}</a>` : ""}
    </article>`).join("");
}
function initSearch(){
  const q = document.getElementById("q"); if(!q || q.dataset.ready) return; q.dataset.ready = "1";
  let tm; q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(runSearch, 350); });
  q.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); runSearch(); } });
  q.addEventListener("focus", loadBooklet, { once: true });
  document.getElementById("q-go").onclick = runSearch;
}


// ===== מחשבון אש״ל ולינה (לשונית האוריינטציה) =====
const CITY_HE = { "Washington DC": "וושינגטון", "New York NY": "ניו יורק", "Boston MA": "בוסטון", "Los Angeles CA": "לוס אנג׳לס", "San Francisco CA": "סן פרנסיסקו",
  "Houston TX": "יוסטון", "Paris": "פריז", "Central London": "לונדון (מרכז)", "Tokyo": "טוקיו", "Moscow": "מוסקבה", "Geneva": "ז׳נבה", "Zurich": "ציריך",
  "Amsterdam": "אמסטרדם", "Sydney": "סידני", "Niue": "ניואה", "Montevideo": "מונטווידאו", "Tashkent": "טשקנט", "Caracas": "קראקס", "Hanoi": "האנוי", "Lusaka": "לוסקה", "Harare": "הררה" };
const OTHER_DEST = "יעד אחר – לא מופיע בטבלה";
const destLabel = r => `${r.he} – ${CITY_HE[r.city] ? CITY_HE[r.city] + " (" + r.city + ")" : r.city === "כל המדינה" ? "כל המדינה" : r.city === "יתר המדינה" ? "יתר המדינה" : r.city} · ${r.country}`;
let calcReady = false;
function initCalc(trip){
  if(typeof ALLOWANCES === "undefined") { document.getElementById("calc").hidden = true; return; }
  const dest = document.getElementById("c-dest"), from = document.getElementById("c-from"), to = document.getElementById("c-to");
  if(!calcReady){
    calcReady = true;
    const dl = document.getElementById("c-dest-list");
    [...ALLOWANCES.map(destLabel), OTHER_DEST].forEach(l => { const o = document.createElement("option"); o.value = l; dl.append(o); });
    [dest, from, to].forEach(i => i.addEventListener("input", calcRun));
    const I = ALLOWANCES_INFO;
    document.getElementById("c-note").innerHTML = `חישוב משוער בלבד, לפי ${esc(I.title)} (בתוקף ${esc(I.valid)}) – <a href="takam-allowances.pdf" target="_blank" rel="noopener">לטבלה המלאה ↗</a>. הזכאות הסופית נקבעת לפי הוראת תכ״ם 13.10.2 (כולל הכללים לימי היציאה והחזרה וניכוי ארוחות שסופקו).`
      + (todayISO() > I.validTo ? ` <strong class="warn">⚠️ תוקף הטבלה הסתיים ב-${esc(I.valid.split("–")[1].trim())} – יש לבדוק אם פורסמה מהדורה חדשה באתר התכ״ם.</strong>` : "");
  }
  if(!from.value && trip.departure && /^\d{4}-\d{2}-\d{2}$/.test(trip.departure)) from.value = trip.departure;
  if(!dest.value && trip.destination){
    const d = nrm(trip.destination);
    const hit = ALLOWANCES.find(r => CITY_HE[r.city] && d.includes(nrm(CITY_HE[r.city]).split(" ")[0])) || ALLOWANCES.find(r => d.includes(nrm(r.he)) || nrm(r.he).includes(d) && d.length > 2);
    if(hit) dest.value = destLabel(hit);
  }
  calcRun();
}
function calcRun(){
  const dv = document.getElementById("c-dest").value.trim(), f = document.getElementById("c-from").value, t = document.getElementById("c-to").value;
  const out = document.getElementById("c-out"), sum = document.getElementById("c-sum");
  let row = ALLOWANCES.find(r => destLabel(r) === dv);
  if(!row && dv){ const q = nrm(dv); const c = ALLOWANCES.filter(r => nrm(destLabel(r)).includes(q)); if(c.length === 1) row = c[0]; }
  const other = dv === OTHER_DEST;
  if(!f || !t || (!row && !other)){ out.innerHTML = ""; sum.textContent = !dv ? "בחרו יעד ותאריכים כדי לראות את החישוב." : (!row && !other ? "בחרו יעד מהרשימה שנפתחת בזמן ההקלדה." : "בחרו תאריך יציאה ותאריך חזרה."); sum.className = "calc-sum muted"; return; }
  const nights = daysBetween(f, t);
  if(nights < 0){ out.innerHTML = ""; sum.textContent = "תאריך החזרה מוקדם מתאריך היציאה."; sum.className = "calc-sum muted"; return; }
  const days = nights + 1;
  const stay = row ? row.stay : (ALLOWANCES_INFO.defaultStay || 180);
  const fmtN = n => Number(n).toLocaleString("he-IL");
  const cells = [
    ["ימים בחו״ל", fmtN(days)], ["לילות", fmtN(nights)],
    ["אש״ל ליום", fmtN(stay) + " ₪"],
    ["לינה ללילה", row ? fmtN(row.lodging) + " " + row.cur : "לבדוק מול קצין הנסיעות"]
  ];
  out.innerHTML = cells.map(([k, v]) => `<div class="cbox"><span>${k}</span><strong>${esc(v)}</strong></div>`).join("");
  const stayTot = stay * days, lodTot = row ? row.lodging * nights : null;
  sum.className = "calc-sum";
  sum.innerHTML = `סה״כ: <strong>דמי אש״ל ${fmtN(stayTot)} ₪</strong> <span class="muted">(${fmtN(days)} ימים × ${fmtN(stay)} ₪)</span> · `
    + (row ? `<strong>דמי לינה ${fmtN(lodTot)} ${row.cur}</strong> <span class="muted">(${fmtN(nights)} לילות × ${fmtN(row.lodging)} ${row.cur})</span>` : `<strong>דמי לינה – לבדוק מול קצין הנסיעות</strong>`);
}

function noteCards(box, list){
  box.innerHTML = "";
  list.forEach(n => {
    const c = el("div","note-card"); c.append(el("h3","", (n.icon ? n.icon + " " : "") + n.title));
    (n.before || []).forEach(t => c.append(el("p","",t)));
    if(n.ol){ const ol = el("ol"); n.ol.forEach(t => ol.append(el("li","",t))); c.append(ol); }
    (n.after || []).forEach(t => c.append(el("p","",t)));
    box.append(c);
  });
}
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
  noteCards(document.getElementById("notes-list"), typeof INFO_NOTES !== "undefined" ? INFO_NOTES : []);
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
  const otop = document.getElementById("orient-top");
  otop.hidden = true;
  if(special){
    renderTabs();
    if(isInfo){ renderInfo(); initSearch(); }
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
    otop.hidden = false;
    initCalc(trip);
    document.getElementById("orient-note").textContent = typeof ORIENT_NOTE === "string" ? ORIENT_NOTE : "";
    noteCards(document.getElementById("orient-notes"), typeof ORIENT_NOTES !== "undefined" ? ORIENT_NOTES : []);
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
  const name = info("שם השליח"), dest = info("יעד"), dep = info("תאריך יציאה"), folder = info("תיקיית מסמכים"), marital = info("מצב משפחתי"), spouse = info("בן/בת זוג");
  const trips = [];
  for(let k = 0; k < n; k++){
    const old = TRIPS[k] || {};
    const t = { title: (head[3 + 2*k] || `שליח ${k+1}`).replace(/\s*[–-]\s*סטטוס$/,""),
      traveler: name(k), destination: dest(k), departure: toISO(dep(k)), folder: folder(k), marital: marital(k), spouse: spouse(k),
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
