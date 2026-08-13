// ---------------------------------------------------------------------------
// tiny API helper
// ---------------------------------------------------------------------------
const api = {
  async get(path) {
    const r = await fetch(path, { credentials: "include" });
    if (!r.ok) throw new Error((await r.json()).detail || "Request failed");
    return r.json();
  },
  async send(method, path, body) {
    const r = await fetch(path, {
      method, credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.json()).detail || "Request failed");
    return r.json();
  },
  post(path, body) { return this.send("POST", path, body); },
  patch(path, body) { return this.send("PATCH", path, body); },
  delete(path) { return this.send("DELETE", path); },
};

function fmtINR(n) {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function monthLabel(m) {
  const [y, mo] = m.split("-");
  return new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

const STATUS_META = {
  paid: { label: "Completed", color: "var(--green)" },
  partial: { label: "Partial", color: "var(--blue)" },
  due_soon: { label: "Due soon", color: "var(--gold)" },
  pending: { label: "Pending", color: "var(--gold)" },
  overdue: { label: "Overdue", color: "var(--red)" },
};

// ---------------------------------------------------------------------------
// push notifications (real phone push — works even when the app is closed,
// via the service worker + your browser's push service). Requires HTTPS
// or localhost; over plain HTTP (e.g. a bare Tailscale IP) this silently
// reports unsupported, which the UI explains.
// ---------------------------------------------------------------------------
function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

async function checkPushStatus() {
  if (!pushSupported()) { state.pushSubscribed = false; return; }
  try {
    // navigator.serviceWorker.ready has no built-in timeout and can hang
    // indefinitely if registration is slow/stuck — race it against a
    // timer so this never blocks the rest of the app from loading.
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("sw timeout")), 3000)),
    ]);
    const sub = await reg.pushManager.getSubscription();
    state.pushSubscribed = !!sub;
  } catch {
    state.pushSubscribed = false;
  }
}

async function enablePushNotifications() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api.get("/api/push/public-key");
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api.post("/api/push/subscribe", sub.toJSON());
    state.pushSubscribed = true;
    render();
  } catch (e) {
    alert("Couldn't enable notifications: " + e.message);
  }
}

async function disablePushNotifications() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } finally {
    state.pushSubscribed = false;
    render();
  }
}

async function sendTestPush() {
  try {
    const res = await api.post("/api/push/test");
    alert(`Sent to ${res.sent} of ${res.total} device(s). Check your phone.`);
  } catch (e) {
    alert(e.message);
  }
}

const DEFAULT_EXPENSE_CATS = ["Rent", "Groceries", "Travel", "Utilities", "Family Support", "Eating Out", "Other"];

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const state = {
  authed: null,        // null = unknown, true/false once checked
  passwordSet: null,
  tab: "overview",
  people: [],
  selectedPersonId: null,
  showArchived: false,
  expenses: [],
  categories: [],
  savingsLog: [],
  dashboard: null,
  summary: null,
  modal: null,          // 'addPerson' | 'addExpense' | 'recordPayment' | 'addSavingsEntry' | 'manageCategories'
  payModalCtx: null,    // { personId, month, remaining }
  editingGoal: false,
  showCategoryManager: false,
  pushSubscribed: false,
  error: null,
};

const app = document.getElementById("app");

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------
async function init() {
  try {
    await loadAll();
    state.authed = true;
    render();
  } catch (e) {
    app.innerHTML = `<div class="card">Couldn't reach the server. Is the backend running? (${e.message})</div>`;
  }
}

async function loadAll() {
  const [dashboard, people, expenses, summary, categories, savingsLog] = await Promise.all([
    api.get("/api/dashboard"),
    api.get(`/api/people?include_archived=${state.showArchived}`),
    api.get("/api/expenses"),
    api.get("/api/summary"),
    api.get("/api/expense-categories"),
    api.get("/api/savings-log"),
  ]);
  state.dashboard = dashboard;
  state.people = people;
  state.expenses = expenses;
  state.summary = summary;
  state.categories = categories;
  state.savingsLog = savingsLog;
  // Deliberately not awaited — push status is a nice-to-have for the
  // Overview tab and must never delay the rest of the app from showing.
  checkPushStatus().then(() => {
    if (state.tab === "overview") render();
  });
}

async function refresh() {
  await loadAll();
  render();
}

// ---------------------------------------------------------------------------
// main render
// ---------------------------------------------------------------------------
function render() {
  app.innerHTML = `
    <div class="header">
      <div>
        <div class="eyebrow">Ledger</div>
        <h1 class="display" style="margin:0;font-size:24px">Collections</h1>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-outline" onclick="downloadBackup()">⬇ Backup</button>
      </div>
    </div>
    <div class="tabs">
      ${tabBtn("overview", "Overview")}
      ${tabBtn("people", "People")}
      ${tabBtn("expenses", "Expenses")}
      ${tabBtn("savings", "Savings")}
      ${tabBtn("summary", "Summary")}
    </div>
    <div id="tab-content"></div>
  `;
  const content = document.getElementById("tab-content");
  try {
    if (state.tab === "overview") content.innerHTML = renderOverview();
    else if (state.tab === "people") content.innerHTML = state.selectedPersonId ? renderPersonDetail() : renderPeopleList();
    else if (state.tab === "expenses") content.innerHTML = renderExpenses();
    else if (state.tab === "savings") content.innerHTML = renderSavings();
    else if (state.tab === "summary") content.innerHTML = renderSummary();
  } catch (e) {
    console.error("Render error:", e);
    content.innerHTML = `
      <div class="card" style="border-color:var(--red)">
        <div style="color:var(--red);font-weight:600;font-size:13px;margin-bottom:8px">Something went wrong displaying this tab</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">This is a bug — please screenshot this box and send it over so it can be fixed.</div>
        <div class="mono" style="font-size:11px;color:var(--muted-2);white-space:pre-wrap;word-break:break-word">${(e && e.message) || e}</div>
      </div>`;
  }

  renderModal();
}

function tabBtn(id, label) {
  return `<button class="tab ${state.tab === id ? "active" : ""}" onclick="setTab('${id}')">${label}</button>`;
}

function setTab(id) {
  state.tab = id;
  state.selectedPersonId = null;
  render();
}

// ---------------------------------------------------------------------------
// overview
// ---------------------------------------------------------------------------
function renderOverview() {
  const d = state.dashboard;
  if (!d) return "";
  const notifs = d.notifications;
  const hasNotifs = notifs.overdue.length || notifs.due_soon.length || notifs.pending.length;
  const notifPermHtml = !pushSupported() ? `
    <div class="card" style="margin-bottom:14px">
      <div style="font-size:12px;color:var(--muted)">Phone notifications need a secure connection (HTTPS) to work. If you're on Tailscale, run <span class="mono" style="color:var(--muted-2)">tailscale serve https / http://localhost:8420</span> on your PC and open that address instead.</div>
    </div>` : state.pushSubscribed ? `
    <div class="card" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--green)">🔔 Phone notifications are on — you'll get a daily alert for anyone overdue or due soon.</div>
      <div style="display:flex;gap:8px">
        <button class="btn-outline" onclick="sendTestPush()">Send test</button>
        <button class="btn-outline" onclick="disablePushNotifications()">Turn off</button>
      </div>
    </div>` : `
    <div class="card" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--muted)">Get a real phone notification when someone's payment is overdue or due soon — works even with the app closed.</div>
      <button class="btn-outline" style="white-space:nowrap" onclick="enablePushNotifications()">🔔 Enable</button>
    </div>`;

  const notifHtml = hasNotifs ? `
    <div class="card" style="margin-bottom:14px;${notifs.overdue.length ? "border-color:var(--red)" : ""}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;color:${notifs.overdue.length ? "var(--red)" : "var(--gold)"};font-size:13px;font-weight:600">
        🔔 Notifications
      </div>
      ${notifs.overdue.map(n => `<div class="notif-line"><span class="dot" style="color:var(--red)">●</span>${n.name} hasn't paid ${fmtINR(n.monthly_due)} — was due on the ${n.due_day}</div>`).join("")}
      ${notifs.due_soon.map(n => `<div class="notif-line" style="color:var(--gold)"><span class="dot" style="color:var(--gold)">●</span>${n.name}'s ${fmtINR(n.monthly_due)} is due on the ${n.due_day} — coming up soon</div>`).join("")}
      ${notifs.pending.map(n => `<div class="notif-line" style="color:var(--muted)"><span class="dot" style="color:var(--muted-2)">●</span>${n.name}'s ${fmtINR(n.monthly_due)} is due on the ${n.due_day} this month</div>`).join("")}
    </div>` : "";

  return `
    ${notifPermHtml}
    ${notifHtml}
    <div class="grid-3" style="margin-bottom:14px">
      <div class="card"><div class="label-sm">COLLECTED THIS MONTH</div><div class="big-num mono" style="color:var(--green)">${fmtINR(d.month_collected)}</div></div>
      <div class="card"><div class="label-sm">OUTSTANDING (ALL)</div><div class="big-num mono" style="color:var(--red)">${fmtINR(d.total_outstanding)}</div></div>
      <div class="card"><div class="label-sm">SPENT THIS MONTH</div><div class="big-num mono">${fmtINR(d.month_expenses)}</div></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="label-sm" style="margin:0">THIS MONTH'S STATUS AT A GLANCE</div>
        <button class="btn-outline" onclick="openModal('addPerson')">+ Add person</button>
      </div>
      ${d.people_status.map(p => {
        const meta = STATUS_META[p.status] || { label: p.status, color: "var(--muted)" };
        const right = p.status === "partial" ? `${fmtINR(p.paid_amount)} / ${fmtINR(p.monthly_due)}` : meta.label;
        return `<div class="row">
          <span onclick="openPerson(${p.person_id})" style="flex:1;cursor:pointer">${p.name}</span>
          <span class="mono" style="font-size:12px;color:${meta.color};margin-right:10px" onclick="openPerson(${p.person_id})">${right}</span>
          <button title="Remove from active list" style="color:var(--muted-2);font-size:11px" onclick="event.stopPropagation();quickArchive(${p.person_id})">🗄</button>
        </div>`;
      }).join("") || `<div style="color:var(--muted-2);font-size:13px;padding:10px 0">No one added yet.</div>`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// savings — net worth, goal, and the savings log all live here, separate
// from Overview
// ---------------------------------------------------------------------------
function renderSavings() {
  const d = state.dashboard;
  if (!d) return "";

  return `
    <div class="card accent-gold" style="margin-bottom:14px">
      <div class="label-sm">NET WORTH SNAPSHOT</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">CASH / BANK</div>
          <input id="cash-balance-input" class="mono" type="number" style="width:110px" value="${d.net_worth.cash_balance}" onchange="updateCashBalance(this.value)">
        </div>
        <div style="font-size:18px;color:var(--muted-2)">+</div>
        <div>
          <div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">OUT ON LOAN</div>
          <div class="mono" style="font-size:17px;font-weight:600">${fmtINR(d.net_worth.principal_out)}</div>
        </div>
        <div style="font-size:18px;color:var(--muted-2)">=</div>
        <div>
          <div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">NET WORTH</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:var(--gold)">${fmtINR(d.net_worth.net_worth)}</div>
        </div>
      </div>
    </div>

    <div class="card accent-teal" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="label-sm" style="margin:0">SAVINGS GOAL</div>
        <button style="color:var(--muted-2);font-size:11px;text-decoration:underline" onclick="toggleGoalEdit()">${state.editingGoal ? "done" : "edit"}</button>
      </div>
      ${state.editingGoal ? `
        <div style="display:flex;gap:12px;margin-bottom:10px">
          <div><div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">CURRENT</div>
            <input class="mono" type="number" style="width:120px" value="${d.savings_goal.current}" onchange="updateSavings('current_savings', this.value)"></div>
          <div><div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">TARGET</div>
            <input class="mono" type="number" style="width:120px" value="${d.savings_goal.goal}" onchange="updateSavings('savings_goal', this.value)"></div>
        </div>` : `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span class="mono" style="font-size:15px;font-weight:600">${fmtINR(d.savings_goal.current)}</span>
          <span class="mono" style="font-size:13px;color:var(--muted)">of ${fmtINR(d.savings_goal.goal)}</span>
        </div>`}
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, d.savings_goal.pct)}%"></div></div>
      <div style="font-size:11px;color:var(--muted-2);margin-top:6px">${d.savings_goal.pct}% of the way there</div>
    </div>

    <div class="card accent-purple">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="label-sm" style="margin:0">SAVINGS LOG</div>
        <button class="btn-outline" onclick="openModal('addSavingsEntry')">+ Add entry</button>
      </div>
      ${state.savingsLog.map(s => `
        <div class="row" style="cursor:default">
          <div>
            <div class="mono" style="font-size:13px;color:var(--green)">${fmtINR(s.amount)}</div>
            <div style="font-size:11px;color:var(--muted-2)">${fmtDate(s.date)}${s.note ? " · " + s.note : ""}</div>
          </div>
          <button style="color:var(--muted-2);font-size:11px" onclick="deleteSavingsEntry(${s.id})">✕</button>
        </div>`).join("") || `<div style="color:var(--muted-2);font-size:12px;padding:6px 0">No entries yet — log what you saved each month, with a note if you like.</div>`}
    </div>
  `;
}

async function quickArchive(personId) {
  await api.post(`/api/people/${personId}/archive`);
  await refresh();
}

function toggleGoalEdit() { state.editingGoal = !state.editingGoal; render(); }

async function updateCashBalance(val) {
  await api.patch("/api/settings", { cash_balance: Number(val) });
  await refresh();
}
async function updateSavings(field, val) {
  await api.patch("/api/settings", { [field]: Number(val) });
  await refresh();
}

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------
function openPerson(id) {
  state.selectedPersonId = id;
  state.tab = "people";
  render();
}

function renderPeopleList() {
  const list = state.showArchived ? state.people.filter(p => p.archived) : state.people.filter(p => !p.archived);
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <button class="btn-primary" onclick="openModal('addPerson')">+ Add person</button>
      <button class="btn-outline" onclick="toggleArchivedView()">🗄 ${state.showArchived ? "Hide" : "Show"} archived</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${list.map(p => {
        const totals = personTotals(p);
        const status = currentMonthStatus(p);
        const meta = STATUS_META[status] || { label: "—", color: "var(--muted)" };
        return `
        <div class="card row" onclick="openPerson(${p.id})" style="opacity:${p.archived ? 0.65 : 1}">
          <div>
            <div style="font-weight:600;font-size:14px;margin-bottom:3px">${p.name} ${p.archived ? '<span style="font-size:10px;color:var(--muted-2);font-weight:400">· archived</span>' : ""}</div>
            <div style="font-size:12px;color:var(--muted)">${fmtINR(p.monthly_due)}/month · due on the ${p.due_day}</div>
          </div>
          <div style="text-align:right">
            ${!p.archived ? `
              <div style="font-size:12px;font-weight:600;color:${meta.color}">${meta.label}</div>
              ${totals.outstanding > 0 ? `<div class="mono" style="font-size:11px;color:var(--red);margin-top:2px">${fmtINR(totals.outstanding)} owed</div>` : ""}
            ` : ""}
          </div>
        </div>`;
      }).join("") || `<div style="color:var(--muted-2);font-size:13px;text-align:center;padding:20px">${state.showArchived ? "No archived people yet." : "No one added yet."}</div>`}
    </div>
  `;
}

function toggleArchivedView() { state.showArchived = !state.showArchived; refresh(); }

function personTotals(p) {
  const collected = (p.payments || []).reduce((s, h) => s + h.paid_amount, 0);
  const cm = (state.dashboard && state.dashboard.month) || new Date().toISOString().slice(0, 7);
  const expected = (p.payments || []).filter(h => h.month <= cm).reduce((s) => s + p.monthly_due, 0);
  const outstanding = Math.max(0, expected - collected);
  const principalOutstanding = Math.max(0, p.amount_given - collected);
  return { collected, outstanding, principalOutstanding };
}

function currentMonthStatus(p) {
  const cm = (state.dashboard && state.dashboard.month) || new Date().toISOString().slice(0, 7);
  const rec = (p.payments || []).find(h => h.month === cm);
  if (!rec) return "pending";
  if (rec.paid_amount >= p.monthly_due) return "paid";
  if (rec.paid_amount > 0) return "partial";
  const today = new Date();
  const due = new Date(rec.due_date);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 2) return "due_soon";
  return "pending";
}

function renderPersonDetail() {
  const p = state.people.find(x => x.id === state.selectedPersonId);
  if (!p) return `<div>Person not found.</div>`;
  const totals = personTotals(p);
  const fullySettled = totals.principalOutstanding === 0;

  const history = [...p.payments].sort((a, b) => b.month.localeCompare(a.month));

  return `
    <button class="btn-outline" style="border:none;padding:0;margin-bottom:14px" onclick="backToPeople()">&larr; Back to people</button>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div>
        <h2 class="display" style="font-size:20px;margin:0 0 4px">${p.name}</h2>
        <div style="font-size:12px;color:var(--muted)">${fmtINR(p.monthly_due)}/month · due on the ${p.due_day}</div>
      </div>
      <div style="display:flex;gap:8px">
        <a href="/api/people/${p.id}/export" class="btn-outline" style="text-decoration:none">⬇ Excel</a>
        <button class="btn-outline" style="border-color:${p.archived ? "var(--border)" : (fullySettled ? "var(--green)" : "var(--border)")};color:${p.archived ? "var(--muted)" : (fullySettled ? "var(--green)" : "var(--muted-2)")}" onclick="toggleArchive(${p.id})">
          ${p.archived ? "↩ Restore" : "🗄 Archive"}
        </button>
        <button class="btn-outline" style="border-color:var(--red);color:var(--red)" onclick="confirmDeletePerson(${p.id}, '${p.name.replace(/'/g, "\\'")}')">🗑</button>
      </div>
    </div>
    ${!p.archived && fullySettled ? `<div style="font-size:12px;color:var(--green);margin-bottom:12px">✓ Fully repaid — you can archive this person</div>` : ""}
    <div class="grid-3" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="card"><div style="font-size:10px;color:var(--muted);margin-bottom:6px">AMOUNT GIVEN</div><div class="mono" style="font-size:16px;font-weight:600">${fmtINR(p.amount_given)}</div>${p.date_given ? `<div style="font-size:10px;color:var(--muted-2);margin-top:3px">on ${fmtDate(p.date_given)}</div>` : ""}</div>
      <div class="card"><div style="font-size:10px;color:var(--muted);margin-bottom:6px">COLLECTED</div><div class="mono" style="font-size:16px;font-weight:600;color:var(--green)">${fmtINR(totals.collected)}</div></div>
      <div class="card"><div style="font-size:10px;color:var(--muted);margin-bottom:6px">OUTSTANDING</div><div class="mono" style="font-size:16px;font-weight:600;color:${totals.outstanding > 0 ? "var(--red)" : "var(--green)"}">${fmtINR(totals.outstanding)}</div></div>
    </div>
    <div class="card">
      <div class="label-sm">MONTHLY HISTORY</div>
      ${history.map(h => {
        const status = h.paid_amount >= p.monthly_due ? "paid" : h.paid_amount > 0 ? "partial" :
          (new Date(h.due_date) < new Date() ? "overdue" : "pending");
        const meta = STATUS_META[status] || { label: status, color: "var(--muted)" };
        return `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 4px;border-bottom:1px solid var(--row-hover)">
          <div>
            <div style="font-size:13px">${monthLabel(h.month)}</div>
            <div style="font-size:11px;color:var(--muted-2)">Due ${fmtDate(h.due_date)}</div>
            ${h.paid_date ? `<div style="font-size:11px;color:var(--muted-2)">Paid on ${fmtDate(h.paid_date)}</div>` : ""}
            ${h.note ? `<div style="font-size:11px;color:var(--muted-2);font-style:italic;max-width:180px">"${h.note}"</div>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <div style="text-align:right">
              <div style="font-size:12px;font-weight:600;color:${meta.color}">${meta.label}</div>
              ${h.paid_amount > 0 ? `<div class="mono" style="font-size:10px;color:var(--muted-2)">${fmtINR(h.paid_amount)} of ${fmtINR(p.monthly_due)}</div>` : ""}
            </div>
            ${h.paid_amount < p.monthly_due && !p.archived ? `
              <div style="display:flex;gap:6px">
                <button class="btn-green-outline" onclick="openPayModal(${p.id}, '${h.month}', ${p.monthly_due - h.paid_amount})">Record payment</button>
                <button class="btn-green-outline" style="border-color:var(--gold);color:var(--gold)" onclick="markComplete(${p.id}, '${h.month}')">Mark completed</button>
              </div>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>
  `;
}

function confirmDeletePerson(id, name) {
  if (confirm(`Delete ${name} permanently? This removes their entire payment history and can't be undone.`)) {
    deletePerson(id);
  }
}

async function deletePerson(id) {
  await api.delete(`/api/people/${id}`);
  state.selectedPersonId = null;
  await refresh();
}

async function markComplete(personId, month) {
  await api.post(`/api/people/${personId}/payments/complete`, { month });
  await refresh();
}

function backToPeople() { state.selectedPersonId = null; render(); }

async function toggleArchive(id) {
  await api.post(`/api/people/${id}/archive`);
  await refresh();
}

// ---------------------------------------------------------------------------
// expenses
// ---------------------------------------------------------------------------
function renderExpenses() {
  const cm = state.dashboard.month;
  const monthTotal = state.expenses.filter(e => e.date.startsWith(cm)).reduce((s, e) => s + e.amount, 0);
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div class="card"><div class="label-sm">THIS MONTH'S SPEND</div><div class="big-num mono">${fmtINR(monthTotal)}</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn-outline" onclick="toggleCategoryManager()">🏷 Categories</button>
        <button class="btn-primary" onclick="openModal('addExpense')">+ Add expense</button>
      </div>
    </div>
    ${state.showCategoryManager ? `
      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="label-sm" style="margin:0">EXPENSE CATEGORIES</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          ${state.categories.map(c => `
            <span style="display:flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:5px 10px;font-size:12px">
              ${c.name}
              <button style="color:var(--muted-2);font-size:10px" onclick="deleteCategory(${c.id})">✕</button>
            </span>`).join("")}
        </div>
        <div style="display:flex;gap:6px">
          <input id="cat-new-name" placeholder="New category name" style="flex:1">
          <button class="btn-outline" onclick="addCategoryFromManager()">Add</button>
        </div>
      </div>` : ""}
    <div class="card">
      ${state.expenses.map(e => `
        <div class="row" style="cursor:default">
          <div>
            <div style="font-size:13px">${e.note || "—"}</div>
            <div style="font-size:11px;color:var(--muted-2)">${e.category} · ${fmtDate(e.date)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="mono" style="font-size:13px;color:var(--red)">${fmtINR(e.amount)}</span>
            <button style="color:var(--muted-2);font-size:11px" onclick="event.stopPropagation();deleteExpense(${e.id})">✕</button>
          </div>
        </div>`).join("") || `<div style="color:var(--muted-2);font-size:13px;text-align:center;padding:20px">No expenses logged yet.</div>`}
    </div>
  `;
}

function toggleCategoryManager() { state.showCategoryManager = !state.showCategoryManager; render(); }

async function addCategoryFromManager() {
  const input = document.getElementById("cat-new-name");
  const name = input.value.trim();
  if (!name) return;
  await api.post("/api/expense-categories", { name });
  await refresh();
}

async function deleteCategory(id) {
  await api.delete(`/api/expense-categories/${id}`);
  await refresh();
}

async function deleteExpense(id) {
  await api.delete(`/api/expenses/${id}`);
  await refresh();
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
function renderSummary() {
  const s = state.summary;
  if (!s) return "";
  return `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div class="label-sm" style="margin:0">FY ${new Date(s.fy_start).getFullYear()}–${String(new Date(s.fy_end).getFullYear()).slice(2)} SUMMARY</div>
        <button class="btn-outline" style="color:var(--gold);border-color:var(--border)" onclick="downloadBackup()">⬇ Export all data</button>
      </div>
      <div style="font-size:11px;color:var(--muted-2);margin-bottom:14px">${fmtDate(s.fy_start)} – ${fmtDate(s.fy_end)}, based on entries so far</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div><div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">COLLECTED (ALL PEOPLE)</div><div class="mono" style="font-size:18px;font-weight:600;color:var(--green)">${fmtINR(s.total_collected)}</div></div>
        <div><div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">TOTAL EXPENSES</div><div class="mono" style="font-size:18px;font-weight:600;color:var(--red)">${fmtINR(s.total_expenses)}</div></div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">EXPENSES BY CATEGORY</div>
      ${s.by_category.map(c => `
        <div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span style="color:var(--muted)">${c.category}</span><span class="mono">${fmtINR(c.amount)}</span>
          </div>
          <div style="height:5px;background:var(--bg);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${s.total_expenses ? (c.amount / s.total_expenses) * 100 : 0}%;background:var(--blue);border-radius:3px"></div>
          </div>
        </div>`).join("") || `<div style="color:var(--muted-2);font-size:12px">No expenses yet this year.</div>`}
    </div>
    <div class="card" style="display:flex;gap:10px">
      <span>🔒</span>
      <div style="font-size:12px;color:var(--muted);line-height:1.5">
        This backup file contains every person, payment, and expense you've recorded. Keep it somewhere private.
      </div>
    </div>
  `;
}

function downloadBackup() {
  window.open("/api/backup", "_blank");
}

// ---------------------------------------------------------------------------
// modals
// ---------------------------------------------------------------------------
function openModal(name) { state.modal = name; render(); }
function closeModal() { state.modal = null; state.payModalCtx = null; render(); }

function openPayModal(personId, month, remaining) {
  state.modal = "recordPayment";
  state.payModalCtx = { personId, month, remaining };
  render();
}

function renderModal() {
  let existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();
  if (!state.modal) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  if (state.modal === "addPerson") {
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><div class="display" style="font-size:16px;font-weight:600">Add person</div><button onclick="closeModal()">✕</button></div>
        <div class="field"><label>NAME</label><input id="p-name" placeholder="e.g. Karthik"></div>
        <div class="field"><label>AMOUNT GIVEN (₹)</label><input id="p-given" type="number" placeholder="50000"></div>
        <div class="field"><label>DATE GIVEN</label><input id="p-date-given" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field"><label>MONTHLY AMOUNT (₹)</label><input id="p-due" type="number" placeholder="5000"></div>
        <div class="field"><label>DUE DAY OF MONTH (1–31)</label><input id="p-day" type="number" placeholder="5"></div>
        <div id="p-error" style="color:var(--red);font-size:12px;margin-bottom:8px;min-height:14px"></div>
        <button class="btn-primary" style="width:100%;justify-content:center" onclick="submitAddPerson()">Save person</button>
      </div>`;
  } else if (state.modal === "addExpense") {
    const today = new Date().toISOString().slice(0, 10);
    const cats = state.categories.length ? state.categories.map(c => c.name) : DEFAULT_EXPENSE_CATS;
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><div class="display" style="font-size:16px;font-weight:600">Add expense</div><button onclick="closeModal()">✕</button></div>
        <div class="field"><label>DATE</label><input id="e-date" type="date" value="${today}"></div>
        <div class="field">
          <label>CATEGORY</label>
          <div style="display:flex;gap:6px">
            <select id="e-cat" style="flex:1">${cats.map(c => `<option value="${c}">${c}</option>`).join("")}</select>
            <button type="button" class="btn-outline" style="white-space:nowrap" onclick="toggleNewCatInput()">+ New</button>
          </div>
          <div id="e-newcat-wrap" style="display:none;margin-top:8px;gap:6px" >
            <input id="e-newcat" placeholder="e.g. Medical" style="margin-bottom:6px">
            <button type="button" class="btn-outline" onclick="addNewCategoryInline()">Add category</button>
          </div>
        </div>
        <div class="field"><label>AMOUNT (₹)</label><input id="e-amount" type="number" placeholder="0"></div>
        <div class="field"><label>NOTE</label><input id="e-note" placeholder="what was this for?"></div>
        <div id="e-error" style="color:var(--red);font-size:12px;margin-bottom:8px;min-height:14px"></div>
        <button class="btn-primary" style="width:100%;justify-content:center" onclick="submitAddExpense()">Save expense</button>
      </div>`;
  } else if (state.modal === "recordPayment") {
    const ctx = state.payModalCtx;
    const today = new Date().toISOString().slice(0, 10);
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><div class="display" style="font-size:16px;font-weight:600">Record payment</div><button onclick="closeModal()">✕</button></div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Remaining due: ${fmtINR(ctx.remaining)}</div>
        <div class="field"><label>AMOUNT RECEIVED (₹)</label><input id="pay-amount" type="number" value="${ctx.remaining}"></div>
        <div class="field"><label>DATE ENTERED</label><input id="pay-date" type="date" value="${today}"></div>
        <div class="field"><label>NOTE (optional)</label><input id="pay-note" placeholder="e.g. cash handover, UPI"></div>
        <div style="font-size:11px;color:var(--muted-2);margin-bottom:16px">Enter less than the full amount to record a partial payment — the rest stays outstanding.</div>
        <div id="pay-error" style="color:var(--red);font-size:12px;margin-bottom:8px;min-height:14px"></div>
        <button class="btn-primary" style="width:100%;justify-content:center;background:var(--green)" onclick="submitPayment()">Save payment</button>
      </div>`;
  } else if (state.modal === "addSavingsEntry") {
    const today = new Date().toISOString().slice(0, 10);
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><div class="display" style="font-size:16px;font-weight:600">Add savings entry</div><button onclick="closeModal()">✕</button></div>
        <div class="field"><label>DATE</label><input id="sv-date" type="date" value="${today}"></div>
        <div class="field"><label>AMOUNT (₹)</label><input id="sv-amount" type="number" placeholder="0"></div>
        <div class="field"><label>NOTE</label><input id="sv-note" placeholder="e.g. leftover after expenses"></div>
        <div id="sv-error" style="color:var(--red);font-size:12px;margin-bottom:8px;min-height:14px"></div>
        <button class="btn-primary" style="width:100%;justify-content:center" onclick="submitSavingsEntry()">Save entry</button>
      </div>`;
  }
  document.body.appendChild(overlay);
}

async function submitAddPerson() {
  const name = document.getElementById("p-name").value.trim();
  const given = Number(document.getElementById("p-given").value || 0);
  const dateGiven = document.getElementById("p-date-given").value || null;
  const due = Number(document.getElementById("p-due").value);
  const day = Number(document.getElementById("p-day").value);
  if (!name || !due || !day) {
    document.getElementById("p-error").textContent = "Name, monthly amount, and due day are required.";
    return;
  }
  try {
    await api.post("/api/people", { name, amount_given: given, date_given: dateGiven, monthly_due: due, due_day: day });
    closeModal();
    await refresh();
  } catch (e) {
    document.getElementById("p-error").textContent = e.message;
  }
}

async function submitAddExpense() {
  const date = document.getElementById("e-date").value;
  const category = document.getElementById("e-cat").value;
  const amount = Number(document.getElementById("e-amount").value);
  const note = document.getElementById("e-note").value.trim();
  if (!date || !amount) {
    document.getElementById("e-error").textContent = "Date and amount are required.";
    return;
  }
  try {
    await api.post("/api/expenses", { date, category, amount, note });
    closeModal();
    await refresh();
  } catch (e) {
    document.getElementById("e-error").textContent = e.message;
  }
}

async function submitPayment() {
  const amount = Number(document.getElementById("pay-amount").value);
  if (!amount || amount <= 0) {
    document.getElementById("pay-error").textContent = "Enter a valid amount.";
    return;
  }
  const paid_date = document.getElementById("pay-date").value || undefined;
  const note = document.getElementById("pay-note").value.trim();
  const ctx = state.payModalCtx;
  try {
    await api.post(`/api/people/${ctx.personId}/payments`, { month: ctx.month, amount, note, paid_date });
    closeModal();
    await refresh();
  } catch (e) {
    document.getElementById("pay-error").textContent = e.message;
  }
}

function toggleNewCatInput() {
  const wrap = document.getElementById("e-newcat-wrap");
  wrap.style.display = wrap.style.display === "none" ? "flex" : "none";
  wrap.style.flexDirection = "column";
}

async function addNewCategoryInline() {
  const name = document.getElementById("e-newcat").value.trim();
  if (!name) return;
  try {
    const cat = await api.post("/api/expense-categories", { name });
    state.categories.push(cat);
    state.categories.sort((a, b) => a.name.localeCompare(b.name));
    renderModal(); // re-render modal with the new category available
    const select = document.getElementById("e-cat");
    if (select) select.value = cat.name;
    document.getElementById("e-newcat-wrap").style.display = "none";
  } catch (e) {
    alert(e.message);
  }
}

async function submitSavingsEntry() {
  const date = document.getElementById("sv-date").value;
  const amount = Number(document.getElementById("sv-amount").value);
  const note = document.getElementById("sv-note").value.trim();
  if (!date || !amount) {
    document.getElementById("sv-error").textContent = "Date and amount are required.";
    return;
  }
  try {
    await api.post("/api/savings-log", { date, amount, note });
    closeModal();
    await refresh();
  } catch (e) {
    document.getElementById("sv-error").textContent = e.message;
  }
}

async function deleteSavingsEntry(id) {
  await api.delete(`/api/savings-log/${id}`);
  await refresh();
}

// ---------------------------------------------------------------------------
init();

// Register service worker for app-shell caching (needs HTTPS or localhost —
// silently no-ops otherwise, which is fine, the app still works normally).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/static/service-worker.js").catch(() => {});
  });
}
