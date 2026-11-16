"use strict";
/* Fenjan HR — installable web app. Data lives in Supabase; access is enforced by the database rules in database.sql. */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CFG = window.FENJAN_CONFIG || {};
const TZ = "Africa/Cairo";
const WD = ["ح", "ن", "ث", "ر", "خ", "ج", "س"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const JOBS = ["مدير صالة", "شيف", "مساعد شيف", "كاشير", "ويتر", "باريستا", "دليفري", "عامل نظافة"];
const REASONS = ["تأخير", "غياب بدون إذن", "انصراف قبل الميعاد", "إهمال في الشغل", "سوء معاملة زبون", "مخالفة النظافة", "تلفيات", "أخرى"];
const ROLES = { pending: "مستني موافقة", employee: "موظف", hr: "HR", owner: "صاحب المطعم" };
const SHIFT = { M: "صباحي", E: "مسائي" };

const pad = n => String(n).padStart(2, "0");
const cairoDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TODAY = cairoDate();
const S = { session: null, me: null, settings: null, people: [], att: [], adv: [], pen: [], ann: [], month: TODAY.slice(0, 7), view: "", tab: "adv", authMode: "in", busy: false, loading: true, punchMsg: "", pushOn: false, pushBusy: false };
let sb = null;
const VAPID_PUBLIC = "BE9BrAMkVAFH_Yo8OfdjqxzQyVJmqLH3C__aDPTYuQObwHeOh4ymSms2r-Ufgd9rVpqUR2Mcs4eTQvM_7Z3QJe8";
function urlB64ToU8(s) { const pad = "=".repeat((4 - s.length % 4) % 4); const b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
async function refreshPushState() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); S.pushOn = !!sub && Notification.permission === "granted"; render(); }
  catch (e) { S.pushOn = false; }
}
async function enablePush() {
  if (S.pushBusy) return;
  if (!pushSupported()) { toast("المتصفح ده مش بيدعم الإشعارات. على الآيفون لازم تضيف التطبيق للشاشة الرئيسية الأول."); return; }
  S.pushBusy = true; render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("لازم تسمح بالإشعارات من المتصفح."); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(VAPID_PUBLIC) });
    await q(sb.from("push_subscriptions").upsert({ user_id: S.me.id, endpoint: sub.endpoint, sub: sub.toJSON() }, { onConflict: "endpoint" }));
    S.pushOn = true; toast("الإشعارات اتفعّلت ✓");
  } catch (e) { toast("معرفناش نفعّل الإشعارات: " + ((e && e.message) || e)); }
  S.pushBusy = false; render();
}
function pushBtn() {
  if (S.pushOn) return `<div class="row"><span class="tag">🔔 إشعارات الموبايل مفعّلة</span></div>`;
  return `<div class="card stack"><div class="row"><span class="grow">فعّل إشعارات الموبايل علشان توصلك الإعلانات حتى والتطبيق مقفول.</span><button class="btn" data-act="push-on" ${S.pushBusy ? "disabled" : ""}>${S.pushBusy ? "لحظة…" : "فعّل الإشعارات"}</button></div><p class="note">على الآيفون: لازم تضيف التطبيق للشاشة الرئيسية الأول، وبعدين تفعّل من هناك.</p></div>`;
}

const money = n => (Math.round((+n || 0) * 100) / 100).toLocaleString("en-US");
const tmin = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const t12 = t => { const m = tmin(t), h = Math.floor(m / 60) % 24; return `${((h + 11) % 12) + 1}:${pad(m % 60)} ${h < 12 ? "ص" : "م"}`; };
const clock = ts => ts ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(ts)).replace("AM", "ص").replace("PM", "م") : "—";
const monthLabel = k => { const [y, m] = k.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
const daysIn = k => { const [y, m] = k.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const shiftMonth = (k, d) => { const [y, m] = k.split("-").map(Number); const x = new Date(y, m - 1 + d, 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };
const isStaff = () => S.me && (S.me.role === "hr" || S.me.role === "owner") && S.me.active;
const shiftHours = c => { const s = S.settings; if (!s) return 0; const a = c === "M" ? [s.m_in, s.m_out] : [s.e_in, s.e_out]; return ((tmin(a[1]) - tmin(a[0]) + 1440) % 1440) / 60; };
const rowHours = r => r.status !== "present" ? 0 : (r.check_in && r.check_out) ? Math.max(0, (new Date(r.check_out) - new Date(r.check_in)) / 3600000) : (r.manual && r.shift ? shiftHours(r.shift) : 0);
const person = id => S.people.find(p => p.id === id) || {};
const workers = () => S.people.filter(p => p.role !== "pending" && p.active).sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), "ar"));
const toEmail = v => { v = String(v || "").trim(); return v.includes("@") ? v.toLowerCase() : v.replace(/\D/g, "") + "@" + (CFG.STAFF_EMAIL_DOMAIN || "fenjan-staff.com"); };

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 3200); }
function say(e) {
  const m = String((e && e.message) || e || "");
  if (/[\u0600-\u06FF]/.test(m)) return m;
  if (m.includes("TOO_FAR")) { const d = (m.match(/TOO_FAR:(\d+)/) || [])[1]; return `إنت بعيد عن المطعم${d ? ` (حوالي ${d} متر)` : ""}. لازم تكون جوه المطعم علشان تسجّل.`; }
  if (m.includes("NOT_APPROVED")) return "حسابك لسه ما اتوافقش عليه. كلّم الإدارة.";
  if (m.includes("SITE_NOT_SET")) return "موقع المطعم لسه متحددش. الإدارة تحدده من الإعدادات.";
  if (m.includes("TOO_SOON")) return "لسه مسجّل دخول من لحظة. استنى دقيقة.";
  if (m.includes("ALREADY_DONE")) return "إنت مسجّل دخول وانصراف النهارده خلاص.";
  if (m.includes("OWNER_ONLY")) return "التغيير ده لصاحب المطعم بس.";
  if (m.includes("Invalid login")) return "البيانات دي مش متسجلة أو كلمة السر غلط. لو دي أول مرة ليك، دوس «حساب جديد» فوق واعمل حساب الأول.";
  if (m.includes("Email not confirmed")) return "الحساب محتاج تأكيد إيميل. اقفل خاصية Confirm email من إعدادات Supabase.";
  if (m.includes("Database error")) return "قاعدة البيانات رفضت الحساب الجديد. اتأكد إن ملف database.sql اتشغّل كله.";
  if (m.includes("rate limit") || m.includes("Too many")) return "محاولات كتير ورا بعض. استنى دقيقة وجرّب تاني.";
  if (m.includes("already registered")) return "الرقم ده متسجل قبل كده. ادخل بكلمة السر.";
  if (m.includes("row-level security") || m.includes("permission denied")) return "مش مسموح لك بالعملية دي.";
  if (m.includes("Failed to fetch") || m.includes("NetworkError")) return "مفيش اتصال بالإنترنت. جرّب تاني.";
  return "حصلت مشكلة: " + (m || "غير معروفة");
}
async function q(promise) { const { data, error } = await promise; if (error) throw error; return data; }

/* ---------- loading ---------- */
async function loadMe() {
  S.settings = await q(sb.from("settings").select("*").eq("id", 1).maybeSingle());
  let me = await q(sb.from("profiles").select("*").eq("id", S.session.user.id).maybeSingle());
  if (!me) {
    // No employee profile yet — create one now (covers a missing/not-yet-run DB trigger).
    try { await sb.rpc("ensure_profile"); me = await q(sb.from("profiles").select("*").eq("id", S.session.user.id).maybeSingle()); }
    catch (e) { /* ensure_profile not installed; paint() shows a clear message */ }
  }
  S.me = me;
}
async function loadMonth() {
  const from = S.month + "-01", to = S.month + "-" + pad(daysIn(S.month));
  const mine = !isStaff();
  const scope = x => mine ? x.eq("user_id", S.me.id) : x;
  const [people, att, adv, pen, ann] = await Promise.all([
    isStaff() ? q(sb.from("profiles").select("*").order("full_name")) : Promise.resolve([S.me]),
    q(scope(sb.from("attendance").select("*").gte("work_date", from).lte("work_date", to))),
    q(scope(sb.from("advances").select("*").gte("entry_date", from).lte("entry_date", to)).order("entry_date", { ascending: false })),
    q(scope(sb.from("penalties").select("*").gte("entry_date", from).lte("entry_date", to)).order("entry_date", { ascending: false })),
    q(sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(50)).catch(() => []),
  ]);
  Object.assign(S, { people, att, adv, pen, ann: ann || [] });
}
async function refresh(silent) {
  if (!S.session) return;
  if (!silent) { S.loading = true; render(); }
  try { await loadMe(); if (S.me && S.me.role !== "pending" && S.me.active) await loadMonth(); }
  catch (e) { toast(say(e)); }
  S.loading = false; render();
}
async function setMonth(k) { S.month = k; await refresh(); }

/* ---------- calculations ---------- */
function tally(uid) {
  const rows = S.att.filter(r => r.user_id === uid);
  const c = { worked: 0, M: 0, E: 0, off: 0, absent: 0, hours: 0, lates: 0, lateMin: 0 };
  rows.forEach(r => {
    if (r.status === "present") { c.worked++; if (r.shift) c[r.shift]++; c.hours += rowHours(r); if (r.late_min > 0) { c.lates++; c.lateMin += r.late_min; } }
    else if (r.status === "off") c.off++; else if (r.status === "absent") c.absent++;
  });
  return c;
}
function payroll() {
  return workers().map(p => {
    const c = tally(p.id), salary = +p.salary || 0;
    const adv = S.adv.filter(a => a.user_id === p.id), pen = S.pen.filter(x => x.user_id === p.id);
    const advBal = adv.reduce((s, a) => s + (+a.amount || 0) - (+a.repaid || 0), 0), penSum = pen.reduce((s, x) => s + (+x.amount || 0), 0);
    const absDed = S.settings.absence_deduct ? Math.round(salary / (S.settings.divisor || 30) * c.absent * 100) / 100 : 0;
    const ded = absDed + advBal + penSum;
    return { p, c, salary, advBal, penCount: pen.length, penSum, absDed, ded, net: salary - ded };
  });
}

/* ---------- views ---------- */
const monthBar = () => `<div class="monthbar"><button class="iconbtn" data-act="month" data-d="-1" aria-label="الشهر السابق">›</button><b>${monthLabel(S.month)}</b><button class="iconbtn" data-act="month" data-d="1" aria-label="الشهر التالي">‹</button></div>`;

function vSetupNeeded() {
  return `<div class="card stack auth"><h1>التطبيق محتاج إعداد</h1><p>ملف <b class="num">config.js</b> لسه فاضي. افتح ملف الخطوات وكمّل الخطوة 3: حط عنوان مشروع Supabase والمفتاح العام.</p></div>`;
}
function vAuth() {
  const up = S.authMode === "up";
  return `<div class="authwrap">
  <div class="hero">
    <span class="hlogo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a3 3 0 0 1 0 6h-1"/><path d="M3 8h14v5a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8Z"/><path d="M7 2.5c-.4.6-.4 1.4 0 2M11 2.5c-.4.6-.4 1.4 0 2"/><path d="M3 21h16"/></svg></span>
    <div class="hname">فنجان</div>
    <div class="htag">نظام شؤون الموظفين</div>
  </div>
  <div class="card stack auth" id="auth">
    <div class="tabs seg2"><button type="button" data-act="auth-in" aria-pressed="${!up}">دخول</button><button type="button" data-act="auth-up" aria-pressed="${up}">حساب جديد</button></div>
    <h1>${up ? "حساب جديد" : "تسجيل الدخول"}</h1>
    ${up ? `<label for="a-name">الاسم بالكامل<input id="a-name" autocomplete="name"></label>` : ""}
    <label for="a-id">رقم التليفون<input id="a-id" dir="ltr" inputmode="tel" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" placeholder="01xxxxxxxxx"></label>
    <label for="a-pw">كلمة السر${up ? " (6 حروف أو أرقام على الأقل)" : ""}<input id="a-pw" type="password" dir="ltr" autocomplete="${up ? "new-password" : "current-password"}" data-act="auth-enter"></label>
    <div class="err" id="a-err" role="alert"></div>
    <button class="btn" type="button" data-act="auth-go" id="a-go">${up ? "اعمل الحساب" : "ادخل"}</button>
    <p class="note">${up ? "أول حساب يتعمل بيبقى صاحب المطعم. أي حساب بعده لازم الإدارة توافق عليه." : "أول مرة تستخدم التطبيق؟ دوس «حساب جديد» فوق. الدخول ده للي عمل حساب قبل كده."}</p></div>
  </div>`;
}
function vPending() {
  return `<div class="card stack auth"><h1>حسابك مستني الموافقة</h1><p>أهلًا ${esc(S.me.full_name)}. حسابك اتعمل، والإدارة هتوافق عليه وبعدها تقدر تسجّل حضورك.</p>
    <div class="row"><button class="btn" data-act="refresh">حدّث</button><button class="btn ghost" data-act="logout">خروج</button></div></div>`;
}
function myToday() {
  const open = S.att.filter(r => r.user_id === S.me.id && r.check_in && !r.check_out).sort((a, b) => new Date(b.check_in) - new Date(a.check_in))[0];
  const today = S.att.find(r => r.user_id === S.me.id && r.work_date === TODAY);
  return { open, today };
}
function annCards(canDelete) {
  if (!S.ann.length) return canDelete ? "" : "";
  return `<div class="stack">${S.ann.map(a => `<div class="card" style="border-inline-start:4px solid var(--accent)"><div class="row"><div class="grow" style="white-space:pre-wrap">${esc(a.body)}</div>${canDelete ? `<button class="btn ghost small" data-act="ann-del" data-id="${a.id}">حذف</button>` : ""}</div><div class="note" style="margin-top:6px">${esc(a.author || "الإدارة")} · ${esc(String(a.created_at || "").slice(0, 10))}</div></div>`).join("")}</div>`;
}
function vAnnounce() {
  return `<h1>إعلان لكل الموظفين</h1>
  ${pushBtn()}
  <div class="card stack"><label for="ann-body">اكتب الإعلان<textarea id="ann-body" rows="4" placeholder="مثال: اجتماع الموظفين بكرة الساعة ١٢ الظهر."></textarea></label>
    <div class="err" id="ann-err" role="alert"></div>
    <div><button class="btn" data-act="ann-post">ابعت لكل الموظفين</button></div>
    <p class="note">الإعلان هيظهر لكل موظف في شاشته أول ما يفتح التطبيق.</p></div>
  ${S.ann.length ? `<h2>الإعلانات المتبعتة</h2>${annCards(true)}` : `<div class="card empty">لسه مفيش إعلانات.</div>`}`;
}
function vMe() {
  const { open, today } = myToday();
  const c = tally(S.me.id);
  const done = today && today.check_in && today.check_out && !open;
  const state = open ? `إنت في الشغل من ${clock(open.check_in)}` : done ? `خلصت شيفتك النهارده (${clock(today.check_in)} ← ${clock(today.check_out)})` : today && today.status === "off" ? "النهارده إجازة" : "لسه ما سجلتش دخول";
  const mine = S.att.filter(r => r.user_id === S.me.id).sort((a, b) => b.work_date.localeCompare(a.work_date));
  const myAdv = S.adv.filter(a => a.user_id === S.me.id), myPen = S.pen.filter(x => x.user_id === S.me.id);
  return `<div class="row"><h1 class="grow">أهلًا ${esc(S.me.full_name)}</h1>${monthBar()}</div>
  ${pushBtn()}
  ${S.ann.length ? `<h2>إعلانات الإدارة</h2>${annCards(false)}` : ""}
  ${S.month === TODAY.slice(0, 7) ? `<div class="card punch">
    <div class="state">${state}</div>
    ${done ? "" : `<button class="big ${open ? "out" : ""}" data-act="punch" ${S.busy ? "disabled" : ""}>${S.busy ? "لحظة…" : open ? "سجّل انصراف" : "سجّل دخول"}</button>`}
    <div class="note">${S.punchMsg ? esc(S.punchMsg) : "لازم تكون جوه المطعم والموقع (GPS) شغال على موبايلك."}</div></div>` : ""}
  <div class="tiles"><div class="tile"><b class="num">${c.worked}</b><span>أيام شغل</span></div><div class="tile"><b class="num">${money(c.hours)}</b><span>ساعات</span></div><div class="tile O"><b class="num">${c.off}</b><span>إجازة</span></div><div class="tile A"><b class="num">${c.absent}</b><span>غياب</span></div><div class="tile"><b class="num">${c.lates}</b><span>مرات تأخير</span></div></div>
  <h2>حضوري في ${monthLabel(S.month)}</h2>
  ${mine.length ? `<div class="scroll"><table><thead><tr><th>اليوم</th><th>الحالة</th><th>دخول</th><th>انصراف</th><th>ساعات</th><th>تأخير</th></tr></thead><tbody>${mine.map(r => `<tr><td class="num">${esc(r.work_date.slice(8))}</td><td>${r.status === "present" ? `<span class="chip ${r.shift || "M"}">${SHIFT[r.shift] || "حاضر"}</span>` : r.status === "off" ? `<span class="chip O">إجازة</span>` : `<span class="chip A">غياب</span>`}</td><td class="num">${clock(r.check_in)}</td><td class="num">${clock(r.check_out)}</td><td class="num">${money(rowHours(r))}</td><td class="num">${r.late_min > 0 ? r.late_min + " د" : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty">مفيش حضور متسجل في الشهر ده.</div>`}
  ${myAdv.length ? `<h2>سلفي</h2><div class="scroll"><table><thead><tr><th>التاريخ</th><th>السلفة</th><th>المسدد</th><th>المتبقي</th></tr></thead><tbody>${myAdv.map(a => `<tr><td class="num">${esc(a.entry_date)}</td><td class="num">${money(a.amount)}</td><td class="num">${money(a.repaid)}</td><td class="num money">${money(a.amount - a.repaid)}</td></tr>`).join("")}</tbody></table></div>` : ""}
  ${myPen.length ? `<h2>جزاءاتي</h2><div class="scroll"><table><thead><tr><th>التاريخ</th><th>السبب</th><th>الخصم</th></tr></thead><tbody>${myPen.map(x => `<tr><td class="num">${esc(x.entry_date)}</td><td>${esc(x.reason)}</td><td class="num money">${money(x.amount)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}
function vToday() {
  const ws = workers(), pend = S.people.filter(p => p.role === "pending");
  const t = { in: 0, done: 0, off: 0, absent: 0, none: 0, late: 0 };
  const rows = ws.map(p => {
    const r = S.att.find(a => a.user_id === p.id && a.work_date === TODAY);
    let st = `<span class="chip O">لسه</span>`;
    if (!r) t.none++;
    else if (r.status === "off") { t.off++; st = `<span class="chip O">إجازة</span>`; }
    else if (r.status === "absent") { t.absent++; st = `<span class="chip A">غياب</span>`; }
    else if (r.check_in && !r.check_out) { t.in++; st = `<span class="chip ${r.shift || "M"}">في الشغل</span>`; }
    else { t.done++; st = `<span class="chip ${r.shift || "M"}">${r.manual ? SHIFT[r.shift] || "حاضر" : "خلص"}</span>`; }
    if (r && r.late_min > 0) t.late++;
    return `<tr><td><b>${esc(p.full_name)}</b><div class="pjob">${esc(p.job || "")}</div></td><td>${st}${r && r.late_min > 0 ? ` <span class="chip A">متأخر ${r.late_min} د</span>` : ""}</td><td class="num">${r ? clock(r.check_in) : "—"}</td><td class="num">${r ? clock(r.check_out) : "—"}</td><td class="num">${r && r.in_dist_m != null ? r.in_dist_m + " م" : r && r.manual ? "يدوي" : "—"}</td><td><button class="btn ghost small" data-act="cell" data-emp="${esc(p.id)}" data-date="${TODAY}">تعديل</button></td></tr>`;
  }).join("");
  const head = `<div class="row"><h1 class="grow">حضور النهارده</h1><button class="iconbtn" data-act="refresh">حدّث</button></div>`;
  const warn = (S.settings && S.settings.site_lat == null ? `<div class="banner"><span class="grow">موقع المطعم لسه متحددش، والموظفين مش هيقدروا يسجّلوا حضور.</span><a class="btn small" href="#setup" style="text-decoration:none">حدّد الموقع</a></div>` : "") +
    (pend.length ? `<div class="banner"><span class="grow">فيه ${pend.length} حساب جديد مستني موافقتك.</span><a class="btn small" href="#staff" style="text-decoration:none">راجع الحسابات</a></div>` : "");
  if (S.month !== TODAY.slice(0, 7)) return head + `<div class="card empty"><b>${monthLabel(S.month)}</b>حضور اليوم بيظهر في الشهر الحالي.<div style="margin-top:12px"><button class="btn" data-act="go-now">ارجع للشهر الحالي</button></div></div>`;
  if (!ws.length) return head + warn + `<div class="card empty"><b>لسه مفيش موظفين</b>ابعت لينك التطبيق للموظفين يعملوا حسابات، وبعدين وافق عليهم من قسم الموظفين.</div>`;
  return head + warn + `<div class="tiles"><div class="tile M"><b class="num">${t.in}</b><span>في الشغل دلوقتي</span></div><div class="tile E"><b class="num">${t.done}</b><span>خلصوا</span></div><div class="tile O"><b class="num">${t.off}</b><span>إجازة</span></div><div class="tile A"><b class="num">${t.absent}</b><span>غياب</span></div><div class="tile"><b class="num">${t.none}</b><span>لسه متسجلش</span></div><div class="tile A"><b class="num">${t.late}</b><span>متأخرين</span></div></div>
  <div class="scroll"><table><thead><tr><th>الموظف</th><th>الحالة</th><th>دخول</th><th>انصراف</th><th>المسافة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function vMonth() {
  const ws = workers(), n = daysIn(S.month), [y, m] = S.month.split("-").map(Number);
  const head = `<div class="row"><h1 class="grow">جدول الشهر</h1>${monthBar()}</div>`;
  if (!ws.length) return head + `<div class="card empty"><b>لسه مفيش موظفين</b></div>`;
  let th = `<th class="who">الموظف</th>`;
  for (let i = 1; i <= n; i++) { const wd = new Date(y, m - 1, i).getDay(), iso = `${S.month}-${pad(i)}`; th += `<th class="${iso === TODAY ? "today" : wd === 5 ? "fri" : ""}"><small>${WD[wd]}</small><span class="num">${i}</span></th>`; }
  th += `<th>أيام</th><th>ساعات</th>`;
  const body = ws.map(p => {
    const by = {}; S.att.filter(a => a.user_id === p.id).forEach(a => by[a.work_date] = a);
    const c = tally(p.id);
    let tds = `<td class="who">${esc(p.full_name)}</td>`;
    for (let i = 1; i <= n; i++) {
      const iso = `${S.month}-${pad(i)}`, r = by[iso];
      const cls = !r ? "" : r.status === "off" ? "O" : r.status === "absent" ? "A" : (r.shift || "M");
      const txt = !r ? "" : r.status === "off" ? "ج" : r.status === "absent" ? "غ" : r.shift === "E" ? "م" : "ص";
      tds += `<td><button class="d ${cls} ${r && r.late_min > 0 ? "late" : ""}" data-act="cell" data-emp="${esc(p.id)}" data-date="${iso}" aria-label="${esc(p.full_name)} يوم ${i}">${txt}</button></td>`;
    }
    return `<tr>${tds}<td class="num">${c.worked}</td><td class="num">${money(c.hours)}</td></tr>`;
  }).join("");
  return head + `<div class="row"><span class="chip M">ص = صباحي</span><span class="chip E">م = مسائي</span><span class="chip O">ج = إجازة</span><span class="chip A">غ = غياب</span><span class="note">النقطة الحمرا = تأخير</span></div>
  <div class="scroll"><table class="grid"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div><p class="note">دوس على أي يوم علشان تشوف تفاصيله أو تعدّله.</p>`;
}
function vStaff() {
  const pend = S.people.filter(p => p.role === "pending"), rest = S.people.filter(p => p.role !== "pending");
  const card = p => `<div class="person"><div class="row"><div class="grow"><div class="pname">${esc(p.full_name || "بدون اسم")} ${p.id === S.me.id ? `<span class="tag">إنت</span>` : ""} ${p.active ? "" : `<span class="tag warn">موقوف</span>`}</div><div class="pjob">${esc(p.job || "—")} · <span class="num">${esc(p.phone || "")}</span> · ${ROLES[p.role]}</div></div>
    ${p.role === "pending" ? "" : `<div style="text-align:end"><div class="money num">${money(p.salary)}</div><div class="note">جنيه / شهر</div></div>`}</div>
    <div class="row">${p.role === "pending" ? `<button class="btn small" data-act="emp-edit" data-id="${esc(p.id)}">وافق وكمّل بياناته</button>` : `<button class="btn ghost small" data-act="emp-edit" data-id="${esc(p.id)}">تعديل</button>`}</div></div>`;
  return `<div class="row"><h1 class="grow">الموظفين <span class="note num">(${rest.length})</span></h1><button class="iconbtn" data-act="refresh">حدّث</button></div>
  ${pend.length ? `<h2>حسابات مستنية الموافقة</h2><div class="card">${pend.map(card).join("")}</div>` : ""}
  ${rest.length ? `<div class="card">${rest.map(card).join("")}</div>` : ""}
  <p class="note">علشان تضيف موظف: ابعتله لينك التطبيق، يعمل حساب برقم تليفونه، وبعدين يظهر هنا وتوافق عليه. وافق بس على اللي تعرفهم.</p>`;
}
function vMoney() {
  const isAdv = S.tab === "adv", rows = isAdv ? S.adv : S.pen;
  const head = `<div class="row"><h1 class="grow">سلف وجزاءات</h1>${monthBar()}</div>
    <div class="row"><div class="tabs grow"><button data-act="tab" data-t="adv" aria-pressed="${isAdv}">السلف</button><button data-act="tab" data-t="pen" aria-pressed="${!isAdv}">الجزاءات</button></div><button class="btn" data-act="${isAdv ? "adv-new" : "pen-new"}" ${workers().length ? "" : "disabled"}>${isAdv ? "سجّل سلفة" : "سجّل جزاء"}</button></div>`;
  if (!rows.length) return head + `<div class="card empty"><b>مفيش ${isAdv ? "سلف" : "جزاءات"} في ${monthLabel(S.month)}</b></div>`;
  if (isAdv) return head + `<div class="scroll"><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>السلفة</th><th>المسدد</th><th>المتبقي</th><th>ملاحظات</th><th></th></tr></thead><tbody>${rows.map(a => `<tr><td class="num">${esc(a.entry_date)}</td><td>${esc(person(a.user_id).full_name || "—")}</td><td class="num">${money(a.amount)}</td><td class="num">${money(a.repaid)}</td><td class="num money">${money(a.amount - a.repaid)}</td><td style="white-space:normal;min-width:120px">${esc(a.note)}</td><td><button class="btn ghost small" data-act="adv-edit" data-id="${a.id}">تعديل</button> <button class="btn ghost small" data-act="adv-del" data-id="${a.id}">حذف</button></td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="4">إجمالي المتبقي</td><td class="num">${money(rows.reduce((s, a) => s + (a.amount - a.repaid), 0))}</td><td colspan="2"></td></tr></tfoot></table></div>`;
  return head + `<div class="scroll"><table><thead><tr><th>التاريخ</th><th>الموظف</th><th>السبب</th><th>الخصم</th><th>ملاحظات</th><th></th></tr></thead><tbody>${rows.map(x => `<tr><td class="num">${esc(x.entry_date)}</td><td>${esc(person(x.user_id).full_name || "—")}</td><td>${esc(x.reason)}</td><td class="num money">${money(x.amount)}</td><td style="white-space:normal;min-width:120px">${esc(x.note)}</td><td><button class="btn ghost small" data-act="pen-edit" data-id="${x.id}">تعديل</button> <button class="btn ghost small" data-act="pen-del" data-id="${x.id}">حذف</button></td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3">إجمالي الخصومات</td><td class="num">${money(rows.reduce((s, x) => s + (+x.amount || 0), 0))}</td><td colspan="2"></td></tr></tfoot></table></div>`;
}
function vPayroll() {
  const rows = payroll(), ad = S.settings.absence_deduct;
  const head = `<div class="row"><h1 class="grow">كشف المرتبات</h1>${monthBar()}</div>`;
  if (!rows.length) return head + `<div class="card empty"><b>لسه مفيش موظفين</b></div>`;
  const T = rows.reduce((t, r) => ({ salary: t.salary + r.salary, ded: t.ded + r.ded, net: t.net + r.net, hours: t.hours + r.c.hours, absent: t.absent + r.c.absent }), { salary: 0, ded: 0, net: 0, hours: 0, absent: 0 });
  return head + `<div class="tiles"><div class="tile"><b class="num">${money(T.net)}</b><span>صافي المرتبات (جنيه)</span></div><div class="tile"><b class="num">${money(T.ded)}</b><span>إجمالي الخصومات</span></div><div class="tile"><b class="num">${money(T.hours)}</b><span>ساعات الشغل</span></div><div class="tile A"><b class="num">${T.absent}</b><span>أيام غياب</span></div></div>
  <div class="scroll"><table><thead><tr><th>الموظف</th><th>أيام الشغل</th><th>إجازة</th><th>غياب</th><th>تأخير</th><th>ساعات</th><th>المرتب</th>${ad ? "<th>خصم الغياب</th>" : ""}<th>متبقي السلف</th><th>الجزاءات</th><th>الصافي</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td><b>${esc(r.p.full_name)}</b><div class="pjob">${esc(r.p.job || "")}</div></td><td class="num">${r.c.worked}</td><td class="num">${r.c.off}</td><td class="num">${r.c.absent ? `<span class="chip A">${r.c.absent}</span>` : 0}</td><td class="num">${r.c.lates ? `${r.c.lates} (${r.c.lateMin} د)` : 0}</td><td class="num">${money(r.c.hours)}</td><td class="num">${money(r.salary)}</td>${ad ? `<td class="num">${money(r.absDed)}</td>` : ""}<td class="num">${money(r.advBal)}</td><td class="num">${money(r.penSum)}</td><td class="num money ${r.net < 0 ? "neg" : ""}">${money(r.net)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="6">الإجمالي</td><td class="num">${money(T.salary)}</td>${ad ? "<td></td>" : ""}<td colspan="2"></td><td class="num">${money(T.net)}</td></tr></tfoot></table></div>
  <div class="row"><button class="btn" data-act="csv">نزّل الكشف (Excel)</button><button class="btn ghost" data-act="copy">انسخ الكشف</button></div>
  <p class="note">الصافي = المرتب − ${ad ? "خصم الغياب − " : ""}المتبقي من سلف الشهر − جزاءات الشهر. ${ad ? `خصم يوم الغياب = المرتب ÷ ${S.settings.divisor}.` : "خصم أيام الغياب مقفول، وتقدر تشغّله من الإعدادات."} التأخير بيظهر للعلم ومش بيتخصم لوحده. الضرايب والتأمينات مش محسوبة هنا.</p>`;
}
function vSetup() {
  const s = S.settings;
  return `<h1>الإعدادات</h1>
  <div class="card stack"><h2>موقع المطعم</h2>
    <div class="row"><span class="grow">${s.site_lat == null ? `<b class="neg">لسه متحددش</b>` : `متحدد <span class="note num">(${(+s.site_lat).toFixed(5)}, ${(+s.site_lng).toFixed(5)})</span>`}</span><span class="note">مسافة السماح: <b class="num">${s.radius_m}</b> متر</span></div>
    <div class="row"><button class="btn" data-act="set-site" ${S.busy ? "disabled" : ""}>${S.busy ? "لحظة…" : "أنا في المطعم دلوقتي: سجّل الموقع"}</button></div>
    <p class="note">اقف جوه المطعم ودوس الزرار. الموظف مش هيقدر يسجّل حضور غير وهو جوه مسافة السماح من النقطة دي.</p></div>
  <div class="card stack"><h2>الشيفتات والقواعد</h2>
    <div class="row"><span class="chip M">صباحي</span><span class="num grow">${t12(s.m_in)} ← ${t12(s.m_out)}</span></div>
    <div class="row"><span class="chip E">مسائي</span><span class="num grow">${t12(s.e_in)} ← ${t12(s.e_out)}</span></div>
    <div class="row"><span class="grow">فترة السماح قبل ما يتحسب تأخير</span><b class="num">${s.grace_min} دقيقة</b></div>
    <div class="row"><span class="grow">خصم أيام الغياب من المرتب</span><b>${s.absence_deduct ? `شغّال (÷ ${s.divisor})` : "مقفول"}</b></div>
    <div><button class="btn" data-act="setup-edit">عدّل</button></div></div>`;
}

const STAFF_NAV = [["today", "اليوم"], ["month", "الشهر"], ["staff", "الموظفين"], ["money", "سلف وجزاءات"], ["payroll", "المرتبات"], ["announce", "إعلانات"], ["me", "حضوري"]];
const _svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS = {
  today: _svg('<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/><path d="m8.5 14.5 2 2 4-4"/>'),
  month: _svg('<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4M7.5 12.5h3M7.5 16h3M13.5 12.5h3M13.5 16h3"/>'),
  staff: _svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 20a5 5 0 0 0-3-4.6"/>'),
  money: _svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>'),
  payroll: _svg('<path d="M6 2.5h9l3.5 3.5V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"/><path d="M14 2.5V6h3.5M12 10.5c-1.3 0-2 .6-2 1.4 0 1.9 4 1 4 2.8 0 .8-.7 1.4-2 1.4m0-5.6c1 0 1.7.3 2 .9m-2-.9V9.5m0 8.3v-1.2m-2 .1c.3.6 1 1 2 1"/>'),
  announce: _svg('<path d="M4 9.5v5a1 1 0 0 0 1 1h2.2l6.3 3.8a.6.6 0 0 0 .9-.5V5.2a.6.6 0 0 0-.9-.5L7.2 8.5H5a1 1 0 0 0-1 1Z"/><path d="M18 9a4 4 0 0 1 0 6"/>'),
  me: _svg('<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>'),
};
const VIEWS = { today: vToday, month: vMonth, staff: vStaff, money: vMoney, payroll: vPayroll, announce: vAnnounce, setup: vSetup, me: vMe };
let raf = 0;
function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); }
function paint() {
  const main = $("#main"), nav = $("#nav"), ha = $("#head-actions");
  nav.hidden = true; ha.innerHTML = "";
  if (!sb) { main.innerHTML = vSetupNeeded(); return; }
  if (!S.session) { main.innerHTML = vAuth(); return; }
  ha.innerHTML = (isStaff() ? `<a class="iconbtn" href="#setup" style="text-decoration:none">الإعدادات</a>` : "") + `<button class="iconbtn" data-act="logout">خروج</button>`;
  if (S.loading) { main.innerHTML = `<div class="card empty"><b>جاري التحميل…</b></div>`; return; }
  if (!S.me) { main.innerHTML = `<div class="card stack auth"><h1>الحساب مش مكتمل</h1><p>دخلت، بس مفيش ملف موظف مربوط بالحساب ده. ده بيحصل لو الحساب اتعمل قبل تجهيز قاعدة البيانات.</p><div class="row"><button class="btn" data-act="refresh">جرّب تاني</button><button class="btn ghost" data-act="logout">خروج</button></div></div>`; return; }
  $("#who").textContent = ROLES[S.me.role] || "";
  if (S.me.role === "pending" || !S.me.active) { main.innerHTML = S.me.active ? vPending() : `<div class="card stack auth"><h1>الحساب موقوف</h1><p>كلّم الإدارة.</p><div><button class="btn ghost" data-act="logout">خروج</button></div></div>`; return; }
  let v = location.hash.slice(1);
  if (!isStaff()) v = "me"; else if (!VIEWS[v]) v = "today";
  S.view = v;
  if (isStaff()) { nav.hidden = false; nav.innerHTML = STAFF_NAV.map(([k, l]) => `<a href="#${k}" ${k === v ? `aria-current="page"` : ""}><span class="ni">${ICONS[k] || ""}</span><span class="nl">${l}</span></a>`).join(""); }
  const sc = $(".scroll"), sl = sc ? sc.scrollLeft : null;
  main.innerHTML = VIEWS[v]();
  if (sl !== null && $(".scroll")) $(".scroll").scrollLeft = sl;
}
window.addEventListener("hashchange", render);
document.addEventListener("keydown", ev => { if (ev.key === "Enter" && ev.target && ev.target.id === "a-pw") { ev.preventDefault(); doAuth(); } });

/* ---------- dialogs ---------- */
const dlg = $("#dlg");
function openDlg(html, onSubmit) {
  dlg.innerHTML = `<form class="dlg" id="f" novalidate>${html}</form>`;
  $("#f").addEventListener("submit", ev => { ev.preventDefault(); onSubmit && onSubmit(new FormData(ev.target), m => { $("#f-err").textContent = m; }); });
  dlg.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => dlg.close()));
  dlg.showModal();
}
const foot = (label, cls = "") => `<div class="err" id="f-err" role="alert"></div><div class="row"><button class="btn ${cls}" type="submit">${label}</button><button class="btn ghost" type="button" data-close>إلغاء</button></div>`;
const empOptions = sel => workers().map(p => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.full_name)}</option>`).join("");
async function run(fn, okMsg) { try { await fn(); dlg.open && dlg.close(); if (okMsg) toast(okMsg); await refresh(true); } catch (e) { const el = $("#f-err"); if (dlg.open && el) el.textContent = say(e); else toast(say(e)); } }
function confirmDlg(title, text, label, fn) { openDlg(`<h3>${esc(title)}</h3><p style="margin:0">${esc(text)}</p>${foot(label, "danger")}`, () => run(fn, "اتمسح")); }

function empDlg(id) {
  const p = person(id), owner = S.me.role === "owner", pend = p.role === "pending";
  const roleOpts = (owner ? ["employee", "hr", "owner"] : ["employee"]).concat(pend ? [] : []).map(r => `<option value="${r}" ${(pend ? "employee" : p.role) === r ? "selected" : ""}>${ROLES[r]}</option>`).join("");
  const lockRole = !owner && (p.role === "hr" || p.role === "owner");
  openDlg(`<h3>${pend ? "موافقة على حساب" : "تعديل موظف"}</h3>
    <label for="e-name">الاسم<input id="e-name" name="full_name" value="${esc(p.full_name)}"></label>
    <div class="two"><label for="e-job">الوظيفة<input id="e-job" name="job" list="jobs" value="${esc(p.job)}"><datalist id="jobs">${JOBS.map(j => `<option value="${j}">`).join("")}</datalist></label>
    <label for="e-salary">المرتب الشهري<input id="e-salary" name="salary" type="number" min="0" step="any" inputmode="decimal" dir="ltr" value="${esc(p.salary)}"></label></div>
    <div class="two"><label for="e-role">الصلاحية<select id="e-role" name="role" ${lockRole ? "disabled" : ""}>${lockRole ? `<option>${ROLES[p.role]}</option>` : roleOpts}</select></label>
    <label for="e-active">الحالة<select id="e-active" name="active"><option value="1" ${p.active ? "selected" : ""}>شغّال</option><option value="0" ${p.active ? "" : "selected"}>موقوف</option></select></label></div>
    <p class="note">HR يشوف ويعدّل كل البيانات ومنها المرتبات. الموظف يشوف بياناته بس.</p>${foot(pend ? "وافق واحفظ" : "حفظ")}`,
    (fd, err) => {
      const name = String(fd.get("full_name") || "").trim(), salary = +fd.get("salary") || 0;
      if (!name) return err("اكتب الاسم.");
      if (salary < 0) return err("المرتب لازم يكون رقم موجب.");
      const patch = { full_name: name, job: String(fd.get("job") || "").trim(), salary, active: fd.get("active") === "1" };
      if (!lockRole) patch.role = fd.get("role") || "employee";
      run(() => q(sb.from("profiles").update(patch).eq("id", id)), "اتحفظ");
    });
}
function cellDlg(emp, date) {
  const p = person(emp), r = S.att.find(a => a.user_id === emp && a.work_date === date);
  const info = r ? `<div class="card stack" style="padding:10px"><div class="row"><span class="grow">الحالة</span><b>${r.status === "present" ? `حاضر ${SHIFT[r.shift] || ""}` : r.status === "off" ? "إجازة" : "غياب"}${r.manual ? " (يدوي)" : ""}</b></div>
    ${r.check_in ? `<div class="row"><span class="grow">دخول</span><b class="num">${clock(r.check_in)}</b><span class="note num">${r.in_dist_m ?? "—"} م</span></div>` : ""}
    ${r.check_out ? `<div class="row"><span class="grow">انصراف</span><b class="num">${clock(r.check_out)}</b><span class="note num">${r.out_dist_m ?? "—"} م</span></div>` : ""}
    ${r.late_min > 0 ? `<div class="row"><span class="grow">تأخير</span><b class="num neg">${r.late_min} دقيقة</b></div>` : ""}</div>` : `<p class="note" style="margin:0">مفيش تسجيل لليوم ده.</p>`;
  openDlg(`<h3>${esc(p.full_name)} · <span class="num">${esc(date)}</span></h3>${info}
    <h2>سجّل يدوي</h2><div class="opts"><button type="button" class="M" data-set="M">حاضر صباحي</button><button type="button" class="E" data-set="E">حاضر مسائي</button><button type="button" class="O" data-set="off">إجازة</button><button type="button" class="A" data-set="absent">غياب</button></div>
    <div class="err" id="f-err" role="alert"></div><div class="row">${r ? `<button class="btn ghost" type="button" data-set="clear">امسح تسجيل اليوم</button>` : ""}<button class="btn ghost" type="button" data-close>قفل</button></div>
    <p class="note">التسجيل اليدوي بيلغي وقت الدخول والانصراف المتسجل بالموبايل لليوم ده.</p>`);
  dlg.querySelectorAll("[data-set]").forEach(b => b.addEventListener("click", () => {
    const v = b.dataset.set;
    if (v === "clear") return run(() => q(sb.from("attendance").delete().eq("user_id", emp).eq("work_date", date)), "اتمسح");
    const row = { user_id: emp, work_date: date, manual: true, check_in: null, check_out: null, in_dist_m: null, out_dist_m: null, late_min: 0,
      status: v === "off" || v === "absent" ? v : "present", shift: v === "M" || v === "E" ? v : null };
    run(() => q(sb.from("attendance").upsert(row, { onConflict: "user_id,work_date" })), "اتحفظ");
  }));
}
function moneyDlg(kind, id) {
  const isAdv = kind === "adv", r = (isAdv ? S.adv : S.pen).find(x => String(x.id) === String(id)) || {};
  const date = r.entry_date || (S.month === TODAY.slice(0, 7) ? TODAY : S.month + "-01");
  openDlg(`<h3>${id ? "تعديل" : "تسجيل"} ${isAdv ? "سلفة" : "جزاء"}</h3>
    <label for="m-emp">الموظف<select id="m-emp" name="user_id">${empOptions(r.user_id)}</select></label>
    <div class="two"><label for="m-date">التاريخ<input id="m-date" name="entry_date" type="date" dir="ltr" value="${esc(date)}"></label>
    <label for="m-amount">${isAdv ? "مبلغ السلفة" : "قيمة الخصم"}<input id="m-amount" name="amount" type="number" min="0" step="any" inputmode="decimal" dir="ltr" value="${esc(r.amount ?? "")}"></label></div>
    ${isAdv ? `<label for="m-repaid">المسدد منها<input id="m-repaid" name="repaid" type="number" min="0" step="any" inputmode="decimal" dir="ltr" value="${esc(r.repaid ?? 0)}"></label>`
      : `<label for="m-reason">السبب<input id="m-reason" name="reason" list="reasons" value="${esc(r.reason || "")}"><datalist id="reasons">${REASONS.map(x => `<option value="${x}">`).join("")}</datalist></label>`}
    <label for="m-note">ملاحظات<input id="m-note" name="note" value="${esc(r.note || "")}"></label>${foot("حفظ")}`,
    (fd, err) => {
      const row = { user_id: fd.get("user_id"), entry_date: fd.get("entry_date"), amount: +fd.get("amount") || 0, note: String(fd.get("note") || "").trim() };
      if (!row.user_id) return err("اختار الموظف."); if (!row.entry_date) return err("اختار التاريخ."); if (row.amount <= 0) return err("اكتب المبلغ.");
      if (isAdv) { row.repaid = +fd.get("repaid") || 0; if (row.repaid > row.amount) return err("المسدد أكبر من مبلغ السلفة."); }
      else { row.reason = String(fd.get("reason") || "").trim(); if (!row.reason) return err("اكتب سبب الجزاء."); }
      const t = sb.from(isAdv ? "advances" : "penalties");
      run(() => q(id ? t.update(row).eq("id", id) : t.insert(row)), "اتحفظ");
    });
}
function setupDlg() {
  const s = S.settings, hm = t => String(t || "").slice(0, 5);
  openDlg(`<h3>الشيفتات والقواعد</h3>
    <div class="two"><label for="s-mi">دخول الصباحي<input id="s-mi" name="m_in" type="time" dir="ltr" value="${hm(s.m_in)}"></label><label for="s-mo">خروج الصباحي<input id="s-mo" name="m_out" type="time" dir="ltr" value="${hm(s.m_out)}"></label></div>
    <div class="two"><label for="s-ei">دخول المسائي<input id="s-ei" name="e_in" type="time" dir="ltr" value="${hm(s.e_in)}"></label><label for="s-eo">خروج المسائي<input id="s-eo" name="e_out" type="time" dir="ltr" value="${hm(s.e_out)}"></label></div>
    <div class="two"><label for="s-r">مسافة السماح (متر)<input id="s-r" name="radius_m" type="number" min="20" max="5000" dir="ltr" value="${esc(s.radius_m)}"></label><label for="s-g">سماح التأخير (دقيقة)<input id="s-g" name="grace_min" type="number" min="0" max="120" dir="ltr" value="${esc(s.grace_min)}"></label></div>
    <div class="two"><label for="s-a">خصم أيام الغياب<select id="s-a" name="abs"><option value="0" ${s.absence_deduct ? "" : "selected"}>مقفول</option><option value="1" ${s.absence_deduct ? "selected" : ""}>شغّال</option></select></label><label for="s-d">المرتب ÷ كام يوم<input id="s-d" name="divisor" type="number" min="1" max="31" dir="ltr" value="${esc(s.divisor)}"></label></div>${foot("حفظ")}`,
    (fd, err) => {
      const g = k => String(fd.get(k) || "");
      if (!["m_in", "m_out", "e_in", "e_out"].every(k => /^\d\d:\d\d/.test(g(k)))) return err("اكتب كل المواعيد.");
      const radius = +g("radius_m"), grace = +g("grace_min"), div = +g("divisor");
      if (!(radius >= 20 && radius <= 5000)) return err("مسافة السماح من 20 لـ 5000 متر.");
      if (!(grace >= 0 && grace <= 120)) return err("سماح التأخير من 0 لـ 120 دقيقة.");
      if (!(div >= 1 && div <= 31)) return err("عدد الأيام من 1 لـ 31.");
      run(() => q(sb.from("settings").update({ m_in: g("m_in"), m_out: g("m_out"), e_in: g("e_in"), e_out: g("e_out"), radius_m: radius, grace_min: grace, absence_deduct: g("abs") === "1", divisor: div }).eq("id", 1)), "اتحفظ");
    });
}

/* ---------- location ---------- */
function locate() {
  return new Promise((ok, no) => {
    if (!navigator.geolocation) return no(new Error("الموبايل ده مش بيدعم تحديد الموقع."));
    navigator.geolocation.getCurrentPosition(p => ok(p.coords), e => no(new Error(e.code === 1 ? "لازم تسمح للتطبيق يستخدم الموقع من إعدادات المتصفح." : "معرفناش نحدد موقعك. شغّل الـ GPS وجرّب تاني.")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}
async function punch() {
  S.busy = true; S.punchMsg = "بنحدد موقعك…"; render();
  try {
    const c = await locate();
    const r = await q(sb.rpc("punch", { p_lat: c.latitude, p_lng: c.longitude }));
    S.punchMsg = r.action === "in" ? `اتسجل دخولك ${clock(r.check_in)} (شيفت ${SHIFT[r.shift]})${r.late_min > 0 ? ` · متأخر ${r.late_min} دقيقة` : ""}` : `اتسجل انصرافك ${clock(r.check_out)}`;
    toast(r.action === "in" ? "اتسجل الدخول" : "اتسجل الانصراف");
  } catch (e) { S.punchMsg = say(e); }
  S.busy = false; await refresh(true);
}
async function setSite() {
  S.busy = true; render();
  try { const c = await locate(); await q(sb.from("settings").update({ site_lat: c.latitude, site_lng: c.longitude }).eq("id", 1)); toast(`الموقع اتسجل (دقة حوالي ${Math.round(c.accuracy)} متر)`); }
  catch (e) { toast(say(e)); }
  S.busy = false; await refresh(true);
}

/* ---------- export ---------- */
function sheet() {
  const head = ["الموظف", "الوظيفة", "أيام الشغل", "صباحي", "مسائي", "إجازة", "غياب", "مرات التأخير", "دقايق التأخير", "الساعات", "المرتب", "خصم الغياب", "متبقي السلف", "عدد الجزاءات", "خصم الجزاءات", "إجمالي الخصومات", "الصافي"];
  return [head, ...payroll().map(r => [r.p.full_name, r.p.job || "", r.c.worked, r.c.M, r.c.E, r.c.off, r.c.absent, r.c.lates, r.c.lateMin, Math.round(r.c.hours * 100) / 100, r.salary, r.absDed, r.advBal, r.penCount, r.penSum, r.ded, r.net])];
}

/* ---------- actions ---------- */
async function doAuth() {
  const err = m => { const e = $("#a-err"); if (e) e.textContent = m; };
  const id = String(($("#a-id") || {}).value || "").trim();
  const pw = String(($("#a-pw") || {}).value || "");
  const name = String(($("#a-name") || {}).value || "").trim();
  if (!id.includes("@") && id.replace(/\D/g, "").length < 10) return err("اكتب رقم التليفون كامل.");
  if (pw.length < 6) return err("كلمة السر 6 حروف أو أرقام على الأقل.");
  if (S.authMode === "up" && !name) return err("اكتب اسمك.");
  const go = $("#a-go"), label = go ? go.textContent : "";
  err(""); if (go) { go.disabled = true; go.textContent = "لحظة…"; }
  try {
    if (S.authMode === "up") {
      const { data, error } = await sb.auth.signUp({ email: toEmail(id), password: pw, options: { data: { full_name: name, phone: id.includes("@") ? "" : id.replace(/\D/g, "") } } });
      if (error) throw error;
      if (!data.session) throw new Error("Email not confirmed");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: toEmail(id), password: pw });
      if (error) throw error;
    }
  } catch (e) { err(say(e)); if ($("#a-go")) { go.disabled = false; go.textContent = label; } }
}
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === "auth-in" || a === "auth-up") { S.authMode = a === "auth-up" ? "up" : "in"; return render(); }
  if (a === "auth-go") return doAuth();
  if (a === "push-on") return enablePush();
  if (a === "logout") { await sb.auth.signOut(); return; }
  if (a === "refresh") return refresh();
  if (a === "month") return setMonth(shiftMonth(S.month, +b.dataset.d));
  if (a === "go-now") return setMonth(TODAY.slice(0, 7));
  if (a === "tab") { S.tab = b.dataset.t; return render(); }
  if (a === "punch") return punch();
  if (!isStaff()) return;
  if (a === "set-site") return setSite();
  if (a === "cell") return cellDlg(b.dataset.emp, b.dataset.date);
  if (a === "emp-edit") return empDlg(id);
  if (a === "adv-new") return moneyDlg("adv");
  if (a === "adv-edit") return moneyDlg("adv", id);
  if (a === "pen-new") return moneyDlg("pen");
  if (a === "pen-edit") return moneyDlg("pen", id);
  if (a === "adv-del") return confirmDlg("حذف سلفة", "السلفة دي هتتمسح ومش هتتحسب في كشف المرتبات.", "احذف", () => q(sb.from("advances").delete().eq("id", id)));
  if (a === "pen-del") return confirmDlg("حذف جزاء", "الجزاء ده هيتمسح ومش هيتخصم من المرتب.", "احذف", () => q(sb.from("penalties").delete().eq("id", id)));
  if (a === "setup-edit") return setupDlg();
  if (a === "ann-post") {
    const el = $("#ann-body"), body = (el && el.value || "").trim();
    if (!body) { const e = $("#ann-err"); if (e) e.textContent = "اكتب الإعلان الأول."; return; }
    try { await q(sb.from("announcements").insert({ body, author: S.me.full_name })); try { await sb.functions.invoke("send-push", { body: { body } }); } catch (_) {} toast("الإعلان اتبعت لكل الموظفين."); await refresh(true); }
    catch (e) { const el2 = $("#ann-err"); if (el2) el2.textContent = say(e); }
    return;
  }
  if (a === "ann-del") return confirmDlg("حذف إعلان", "الإعلان ده هيتشال من عند كل الموظفين.", "احذف", () => q(sb.from("announcements").delete().eq("id", id)));
  if (a === "copy") { try { await navigator.clipboard.writeText(sheet().map(r => r.join("\t")).join("\n")); toast("الكشف اتنسخ."); } catch (e) { toast("النسخ مش متاح هنا."); } return; }
  if (a === "csv") {
    const csv = "\ufeff" + sheet().map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const l = document.createElement("a"); l.href = url; l.download = `fenjan-payroll-${S.month}.csv`; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
});

/* ---------- start ---------- */
(async function start() {
  // Clear any old caching worker, then register the push-only worker (no fetch handler → never serves stale code).
  if (window.caches && caches.keys) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.getRegistrations().then(rs => {
      rs.forEach(r => { if (r.active && /\/sw\.js/.test(r.active.scriptURL)) r.unregister(); });
    }).catch(() => {});
    navigator.serviceWorker.register("sw-push.js?v=8").then(() => refreshPushState()).catch(() => {});
  }
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY || !window.supabase) { render(); return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  const { data } = await sb.auth.getSession();
  S.session = data.session; S.loading = !!S.session; render();
  if (S.session) refresh();
  sb.auth.onAuthStateChange((evt, session) => {
    const was = S.session && S.session.user.id, now = session && session.user.id;
    S.session = session;
    if (!session) { Object.assign(S, { me: null, people: [], att: [], adv: [], pen: [], loading: false }); $("#who").textContent = "شؤون الموظفين"; render(); }
    else if (was !== now) setTimeout(() => refresh(), 0);
  });
})();
