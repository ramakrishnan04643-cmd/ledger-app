// ---------------------------------------------------------------------------
// tiny API helper
// ---------------------------------------------------------------------------
const api = {
  async get(path) {
    const r = await fetch(path, { credentials: "include" });
    if (r.status === 401) { state.authed = false; render(); throw new Error("unauthorized"); }
    if (!r.ok) throw new Error((await r.json()).detail || "Request failed");
    return r.json();
  },
  async send(method, path, body) {
    const r = await fetch(path, {
      method, credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { state.authed = false; render(); throw new Error("unauthorized"); }
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
// push notifications
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
    const reg = await navigator.serviceWorker.ready;
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
  authed: null,        // null = unknown/loading, true/false once resolved
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
  modal: null,          // 'addPerson' | 'addExpense' | 'recordPayment' | 'addSavingsEntry'
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
    const status = await api.get("/api/auth/status");
    state.passwordSet = Boolean(status.password_set);
    
    if (!state.passwordSet) {
      state.authed = false;
      renderSetup();
      return;
    }
    
    // Password is set, attempt to fetch protected data
    try {
      await loadAll();
      state.authed = true;
      render();
    } catch (err) {
      // 401 Unauthorized or failure to fetch loads login screen directly
      state.authed = false;
      renderLogin();
    }
  } catch (e) {
    state.authed = false;
    app.innerHTML = `
      <div class="card" style="margin:20px;border-color:var(--red)">
        <h3 style="color:var(--red);margin-top:0">Unable to connect</h3>
        <p style="color:var(--muted);font-size:13px">Could not reach the backend server (${e.message}). Ensure your server is running and refresh.</p>
        <button class="btn-primary" onclick="init()">Retry Connection</button>
      </div>`;
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
  await checkPushStatus();
}

async function refresh() {
  await loadAll();
  render();
}

// ---------------------------------------------------------------------------
// auth screens
// ---------------------------------------------------------------------------
function renderSetup() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="eyebrow" style="justify-content:center">🔒 Private ledger</div>
        <h1 class="display" style="margin:6px 0 4px">Set a password</h1>
        <p style="color:var(--muted);font-size:13px;margin-bottom:18px">This is your first time here. Choose a password to lock the app.</p>
        <div class="field" style="text-align:left">
          <label>PASSWORD</label>
          <input id="setup-pw" type="password" placeholder="At least 4 characters" autofocus>
        </div>
        <div id="setup-error" style="color:var(--red);font-size:12px;margin-bottom:10px;min-height:14px"></div>
        <button class="btn-primary" style="width:100%;justify-content:center" onclick="doSetup()">Set password &amp; continue</button>
      </div>
    </div>`;
  document.getElementById("setup-pw").addEventListener("keydown", e => { if (e.key === "Enter") doSetup(); });
}

async function doSetup() {
  const pw = document.getElementById("setup-pw").value;
  try {
    await api.post("/api/auth/set-password", { password: pw });
    state.passwordSet = true;
    state.authed = true;
    await loadAll();
    render();
  } catch (e) {
    if (e.message && e.message.includes("already set")) {
      state.passwordSet = true;
      state.authed = false;
      renderLogin();
    } else {
      document.getElementById("setup-error").textContent = e.message;
    }
  }
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="eyebrow" style="justify-content:center">🔒 Private ledger</div>
        <h1 class="display" style="margin:6px 0 4px">Enter password</h1>
        <div class="field" style="text-align:left;margin-top:14px">
          <label>PASSWORD</label>
          <input id="login-pw" type="password" autofocus>
        </div>
        <div id="login-error" style="color:var(--red);font-size:12px;margin-bottom:10px;min-height:14px"></div>
        <button class="btn-primary" style="width:100%;justify-content:center" onclick="doLogin()">Unlock</button>
      </div>
    </div>`;
  document.getElementById("login-pw").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
}

async function doLogin() {
  const pw = document.getElementById("login-pw").value;
  try {
    await api.post("/api/auth/login", { password: pw });
    state.authed = true;
    await loadAll();
    render();
  } catch (e) {
    document.getElementById("login-error").textContent = e.message;
  }
}

async function doLogout() {
  await api.post("/api/auth/logout");
  state.authed = false;
  renderLogin();
}

// ---------------------------------------------------------------------------
// main render
// ---------------------------------------------------------------------------
function render() {
  if (state.authed === false) { 
    if (!state.passwordSet) {
      renderSetup();
    } else {
      renderLogin(); 
    }
    return; 
  }
  if (state.authed !== true) return;

  app.innerHTML = `
    <div class="header">
      <div>
        <div class="eyebrow">🔒 Private ledger</div>
        <h1 class="display" style="margin:0;font-size:24px">Collections</h1>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-outline" onclick="downloadBackup()">⬇ Backup</button>
        <button class="btn-outline" onclick="doLogout()">Lock</button>
      </div>
    </div>
    <div class="tabs">
      ${tabBtn("overview", "Overview")}
      ${tabBtn("people", "People")}
      ${tabBtn("expenses", "Expenses")}
      ${tabBtn("summary", "Summary")}
    </div>
    <div id="tab-content"></div>
  `;
  const content = document.getElementById("tab-content");
  try {
    if (state.tab === "overview") content.innerHTML = renderOverview();
    else if (state.tab === "people") content.innerHTML = state.selectedPersonId ? renderPersonDetail() : renderPeopleList();
    else if (state.tab === "expenses") content.innerHTML = renderExpenses();
    else if (state.tab === "summary") content.innerHTML = renderSummary();
  } catch (e) {
    console.error("Render error:", e);
    content.innerHTML = `
      <div class="card" style="border-color:var(--red)">
        <div style="color:var(--red);font-weight:600;font-size:13px;margin-bottom:8px">Something went wrong displaying this tab</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Details below:</div>
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
  const notifs = d.notifications || { overdue: [], due_soon: [], pending: [] };
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
      ${notifs.due_soon.map(n => `<div class="notif-line" style="color:#F0D9A0"><span class="dot" style="color:var(--gold)">●</span>${n.name}'s ${fmtINR(n.monthly_due)} is due on the ${n.due_day} — coming up soon</div>`).join("")}
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

    <div class="card" style="margin-bottom:14px">
      <div class="label-sm">NET WORTH SNAPSHOT</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">CASH / BANK</div>
          <input id="cash-balance-input" class="mono" type="number" style="width:110px" value="${(d.net_worth && d.net_worth.cash_balance) || 0}" onchange="updateCashBalance(this.value)">
        </div>
        <div style="font-size:18px;color:var(--muted-2)">+</div>
        <div>
          <div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">OUT ON LOAN</div>
          <div class="mono" style="font-size:17px;font-weight:600">${fmtINR((d.net_worth && d.net_worth.principal_out) || 0)}</div>
        </div>
        <div style="font-size:18px;color:var(--muted-2)">=</div>
        <div>
          <div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">NET WORTH</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:var(--gold)">${fmtINR((d.net_worth && d.net_worth.net_worth) || 0)}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="label-sm" style="margin:0">SAVINGS GOAL</div>
        <button style="color:var(--muted-2);font-size:11px;text-decoration:underline" onclick="toggleGoalEdit()">${state.editingGoal ? "done" : "edit"}</button>
      </div>
      ${state.editingGoal ? `
        <div style="display:flex;gap:12px;margin-bottom:10px">
          <div><div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">CURRENT</div>
            <input class="mono" type="number" style="width:120px" value="${d.savings_goal ? d.savings_goal.current : 0}" onchange="updateSavings('current_savings', this.value)"></div>
          <div><div style="font-size:10px;color:var(--muted-2);margin-bottom:4px">TARGET</div>
            <input class="mono" type="number" style="width:120px" value="${d.savings_goal ? d.savings_goal.goal : 0}" onchange="updateSavings('savings_goal', this.value)"></div>
        </div>` : `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span class="mono" style="font-size:15px;font-weight:600">${fmtINR(d.savings_goal ? d.savings_goal.current : 0)}</span>
          <span class="mono" style="font-size:13px;color:var(--muted)">of ${fmtINR(d.savings_goal ? d.savings_goal.goal : 0)}</span>
        </div>`}
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, (d.savings_goal ? d.savings_goal.pct : 0))}%"></div></div>
      <div style="font-size:11px;color:var(--muted-2);margin-top:6px">${(d.savings_goal ? d.savings_goal.pct : 0)}% of the way there</div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="label-sm" style="margin:0">SAVINGS LOG</div>
        <button class="btn-outline" onclick="openModal('addSavingsEntry')">+ Add entry</button>
      </div>
      ${state.savingsLog.slice(0, 5).map(s => `
        <div class="row" style="cursor:default">
          <div>
            <div class="mono" style="font-size:13px;color:var(--green)">${fmtINR(s.amount)}</div>
            <div style="font-size:11px;color:var(--muted-2)">${fmtDate(s.date)}${s.note ? " · " + s.note : ""}</div>
          </div>
          <button style="color:var(--muted-2);font-size:11px" onclick="deleteSavingsEntry(${s.id})">✕</button>
        </div>`).join("") || `<div style="color:var(--muted-2);font-size:12px;padding:6px 0">No entries yet — log what you saved each month, with a note if you like.</div>`}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="label-sm" style="margin:0">THIS MONTH'S STATUS AT A GLANCE</div>
        <button class="btn-outline" onclick="openModal('addPerson')">+ Add person</button>
      </div>
      ${(d.people_status || []).map(p => {
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

  const history = [...(p.payments || [])].sort((a, b) => b.month.localeCompare(a.month));

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
      <div class="card"><div style="font-size:10px;color:var(--muted);margin-bottom:6px">AMOUNT GIVEN</div><div class="mono" style="font-size:16px;font-weight:600">${fmtINR(p.amount_given)}</div></div>
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
  const cm = (state.dashboard && state.dashboard.month) || new Date().toISOString().slice(0, 7);
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
        <button class="btn-outline" style="color:var(--gold);border-color:#3A3B6A" onclick="downloadBackup()">⬇ Export all data</button>
      </div>
      <div style="font-size:11px;color:var(--muted-2);margin-bottom:14px">${fmtDate(s.fy_start)} – ${fmtDate(s.fy_end)}, based on payments recorded</div>
      <div class="grid-3" style="margin-bottom:14px">
        <div class="card"><div class="label-sm">TOTAL COLLECTED</div><div class="big-num mono" style="color:var(--green)">${fmtINR(s.total_collected)}</div></div>
        <div class="card"><div class="label-sm">TOTAL EXPENSES</div><div class="big-num mono" style="color:var(--red)">${fmtINR(s.total_expenses)}</div></div>
        <div class="card"><div class="label-sm">NET SAVINGS</div><div class="big-num mono" style="color:var(--gold)">${fmtINR(s.net_savings)}</div></div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// modals
// ---------------------------------------------------------------------------
function openModal(name) { state.modal = name; render(); }

function closeModal() {
  state.modal = null;
  state.payModalCtx = null;
  const existing = document.querySelector(".modal-backdrop");
  if (existing) existing.remove();
}

function openPayModal(personId, month, remaining) {
  state.payModalCtx = { personId, month, remaining };
  openModal('recordPayment');
}

function renderModal() {
  const existing = document.querySelector(".modal-backdrop");
  if (existing) existing.remove();

  if (!state.modal) return;
  
  let modalContent = "";
  if (state.modal === "addPerson") modalContent = renderAddPersonModal();
  else if (state.modal === "addExpense") modalContent = renderAddExpenseModal();
  else if (state.modal === "recordPayment") modalContent = renderRecordPaymentModal();
  else if (state.modal === "addSavingsEntry") modalContent = renderAddSavingsModal();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };
  backdrop.innerHTML = `
    <div class="modal card">
      <button class="modal-close" onclick="closeModal()">✕</button>
      ${modalContent}
    </div>`;
  document.body.appendChild(backdrop);
}

function renderAddPersonModal() {
  return `
    <h3 class="display" style="margin:0 0 14px">Add Person</h3>
    <div class="field"><label>NAME</label><input id="p-name" type="text" autofocus></div>
    <div class="field"><label>PRINCIPAL AMOUNT (GIVEN)</label><input id="p-given" type="number" value="0"></div>
    <div class="field"><label>MONTHLY DUE</label><input id="p-due" type="number" value="0"></div>
    <div class="field"><label>DUE DAY OF MONTH (1-31)</label><input id="p-day" type="number" value="1" min="1" max="31"></div>
    <div id="modal-error" style="color:var(--red);font-size:12px;margin-bottom:10px"></div>
    <button class="btn-primary" style="width:100%" onclick="submitAddPerson()">Save</button>
  `;
}

async function submitAddPerson() {
  const name = document.getElementById("p-name").value.trim();
  const amount_given = Number(document.getElementById("p-given").value);
  const monthly_due = Number(document.getElementById("p-due").value);
  const due_day = Number(document.getElementById("p-day").value);

  if (!name) { document.getElementById("modal-error").textContent = "Name is required"; return; }

  try {
    await api.post("/api/people", { name, amount_given, monthly_due, due_day });
    closeModal();
    await refresh();
  } catch (e) {
    document.getElementById("modal-error").textContent = e.message;
  }
}

function renderAddExpenseModal() {
  const today = new Date().toISOString().slice(0, 10);
  const catOptions = state.categories.length ? state.categories : DEFAULT_EXPENSE_CATS.map((c) => ({ id: c, name: c }));
  return `
    <h3 class="display" style="margin:0 0 14px">Add Expense</h3>
    <div class="field"><label>AMOUNT</label><input id="e-amount" type="number" autofocus></div>
    <div class="field"><label>CATEGORY</label>
      <select id="e-category">
        ${catOptions.map(c => `<option value="${c.name}">${c.name}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>DATE</label><input id="e-date" type="date" value="${today}"></div>
    <div class="field"><label>NOTE / DESCRIPTION</label><input id="e-note" type="text"></div>
    <div id="modal-error" style="color:var(--red);font-size:12px;margin-bottom:10px"></div>
    <button class="btn-primary" style="width:100%" onclick="submitAddExpense()">Save Expense</button>
  `;
}

async function submitAddExpense() {
  const amount = Number(document.getElementById("e-amount").value);
  const category = document.getElementById("e-category").value;
  const date = document.getElementById("e-date").value;
  const note = document.getElementById("e-note").value.trim();

  if (!amount) { document.getElementById("modal-error").textContent = "Amount is required"; return; }

  try {
    await api.post("/api/expenses", { amount, category, date, note });
    closeModal();
    await refresh();
  } catch (e) {
    document.getElementById("modal-error").textContent = e.message;
  }
}

function renderRecordPaymentModal() {
  const ctx = state.payModalCtx;
  const today = new Date().toISOString().slice(0, 10);
  return `
    <h3 class="display" style="margin:0 0 14px">Record Payment</h3>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Recording for ${monthLabel(ctx.month)}</div>
    <div class="field"><label>AMOUNT PAID</label><input id="pay-amount" type="number" value="${ctx.remaining}" autofocus></div>
    <div class="field"><label>PAYMENT DATE</label><input id="pay-date" type="date" value="${today}"></div>
    <div class="field"><label>NOTE</label><input id="pay-note" type="text" placeholder="Optional"></div>
    <div id="modal-error" style="color:var(--red);font-size:12px;margin-bottom:10px"></div>
    <button class="btn-primary" style="width:100%" onclick="submitRecordPayment()">Save Payment</button>
  `;
}

async function submitRecordPayment() {
  const ctx = state.payModalCtx;
  const amount = Number(document.getElementById("pay-amount").value);
  const date = document.getElementById("pay-date").value;
  const note = document.getElementById("pay-note").value.trim();

  try {
    await api.post(`/api/people/${ctx.personId}/payments`, { month: ctx.month, amount, date, note });
    closeModal();
    await refresh();
  } catch (e) {
    document.getElementById("modal-error").textContent = e.message;
  }
}

function renderAddSavingsModal() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <h3 class="display" style="margin:0 0 14px">Add Savings Entry</h3>
    <div class="field"><label>AMOUNT SAVED</label><input id="s-amount" type="number" autofocus></div>
    <div class="field"><label>DATE</label><input id="s-date" type="date" value="${today}"></div>
    <div class="field"><label>NOTE</label><input id="s-note" type="text" placeholder="e.g. Monthly transfer to FD"></div>
    <div id="modal-error" style="color:var(--red);font-size:12px;margin-bottom:10px"></div>
    <button class="btn-primary" style="width:100%" onclick="submitAddSavings()">Save Entry</button>
  `;
}

async function submitAddSavings() {
  const amount = Number(document.getElementById("s-amount").value);
  const date = document.getElementById("s-date").value;
  const note = document.getElementById("s-note").value.trim();

  if (!amount) { document.getElementById("modal-error").textContent = "Amount is required"; return; }

  try {
    await api.post("/api/savings-log", { amount, date, note });
    closeModal();
    await refresh();
  } catch (e) {
    document.getElementById("modal-error").textContent = e.message;
  }
}

async function deleteSavingsEntry(id) {
  await api.delete(`/api/savings-log/${id}`);
  await refresh();
}

function downloadBackup() {
  window.location.href = "/api/backup";
}

// Kick off initialization
init();