// Standalone Client-Side app.js with Full Ledger Functionality

const state = {
  passwordSet: false,
  authed: false,
  entries: []
};

document.addEventListener("DOMContentLoaded", () => {
  state.passwordSet = !!localStorage.getItem("ledger_password_hash");
  loadEntries();
  render();
});

// SHA-256 password hashing helper
async function hashPassword(password) {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Load entries from localStorage
function loadEntries() {
  const data = localStorage.getItem("ledger_entries");
  state.entries = data ? JSON.parse(data) : [];
}

// Save entries to localStorage
function saveEntries() {
  localStorage.setItem("ledger_entries", JSON.stringify(state.entries));
}

async function handleAuthSubmit(e) {
  if (e) e.preventDefault();

  const input = document.getElementById("pw-input");
  const errContainer = document.getElementById("auth-error");
  if (!input || !input.value) return;

  const enteredPassword = input.value;

  if (!state.passwordSet) {
    if (enteredPassword.length < 4) {
      if (errContainer) errContainer.innerText = "Password must be at least 4 characters.";
      return;
    }
    const hash = await hashPassword(enteredPassword);
    localStorage.setItem("ledger_password_hash", hash);
    state.passwordSet = true;
    state.authed = true;
    render();
  } else {
    const storedHash = localStorage.getItem("ledger_password_hash");
    const enteredHash = await hashPassword(enteredPassword);

    if (enteredHash === storedHash) {
      state.authed = true;
      render();
    } else {
      if (errContainer) errContainer.innerText = "Invalid password.";
    }
  }
}

function handleAddEntry(e) {
  e.preventDefault();
  const desc = document.getElementById("entry-desc").value;
  const amount = parseFloat(document.getElementById("entry-amount").value);
  const type = document.getElementById("entry-type").value;
  const category = document.getElementById("entry-category").value;
  const date = document.getElementById("entry-date").value || new Date().toISOString().split('T')[0];

  if (!desc || isNaN(amount)) return;

  state.entries.push({ id: Date.now(), date, desc, amount, type, category });
  saveEntries();
  render();
}

function deleteEntry(id) {
  state.entries = state.entries.filter(item => item.id !== id);
  saveEntries();
  render();
}

function render() {
  const root = document.getElementById("app") || document.body;

  if (!state.authed) {
    const title = state.passwordSet ? "Enter password" : "Create password";
    const buttonText = state.passwordSet ? "Unlock" : "Set Password";

    root.innerHTML = `
      <div class="auth-card">
        <div class="auth-header">🔒 PRIVATE LEDGER</div>
        <h2>${title}</h2>
        <form id="auth-form">
          <label>PASSWORD</label>
          <input type="password" id="pw-input" required autofocus placeholder="••••" />
          <div id="auth-error" style="color: #ff6b6b; margin-top: 8px; font-size: 14px;"></div>
          <button type="submit" id="auth-btn">${buttonText}</button>
        </form>
      </div>
    `;

    document.getElementById("auth-form").addEventListener("submit", handleAuthSubmit);
    return;
  }

  // Calculate totals
  const income = state.entries.filter(e => e.type === 'Income').reduce((sum, e) => sum + e.amount, 0);
  const expense = state.entries.filter(e => e.type === 'Expense').reduce((sum, e) => sum + e.amount, 0);
  const balance = income - expense;

  // Unlocked Dashboard View
  root.innerHTML = `
    <div class="ledger-dashboard" style="padding: 20px; max-width: 800px; margin: 0 auto; font-family: sans-serif;">
      <header style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 10px;">
        <h1>Private Ledger</h1>
        <div>
          <button onclick="localStorage.removeItem('ledger_password_hash'); location.reload();">Reset Password</button>
          <button onclick="location.reload();">Lock</button>
        </div>
      </header>

      <section style="display: flex; gap: 20px; margin: 20px 0;">
        <div style="flex: 1; padding: 15px; background: #1e293b; border-radius: 8px;">
          <h3>Balance</h3>
          <p style="font-size: 24px;">$${balance.toFixed(2)}</p>
        </div>
        <div style="flex: 1; padding: 15px; background: #1e293b; border-radius: 8px; color: #4ade80;">
          <h3>Income</h3>
          <p style="font-size: 24px;">+$${income.toFixed(2)}</p>
        </div>
        <div style="flex: 1; padding: 15px; background: #1e293b; border-radius: 8px; color: #f87171;">
          <h3>Expense</h3>
          <p style="font-size: 24px;">-$${expense.toFixed(2)}</p>
        </div>
      </section>

      <form id="entry-form" style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;">
        <input type="date" id="entry-date" required />
        <input type="text" id="entry-desc" placeholder="Description" required />
        <input type="number" step="0.01" id="entry-amount" placeholder="Amount" required />
        <select id="entry-type">
          <option value="Expense">Expense</option>
          <option value="Income">Income</option>
        </select>
        <input type="text" id="entry-category" placeholder="Category" />
        <button type="submit">Add Entry</button>
      </form>

      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr style="border-bottom: 1px solid #444;">
            <th style="padding: 8px;">Date</th>
            <th style="padding: 8px;">Description</th>
            <th style="padding: 8px;">Category</th>
            <th style="padding: 8px;">Type</th>
            <th style="padding: 8px;">Amount</th>
            <th style="padding: 8px;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.entries.length === 0 ? '<tr><td colspan="6" style="padding: 15px; text-align: center;">No transactions found.</td></tr>' : ''}
          ${state.entries.map(e => `
            <tr style="border-bottom: 1px solid #333;">
              <td style="padding: 8px;">${e.date}</td>
              <td style="padding: 8px;">${e.desc}</td>
              <td style="padding: 8px;">${e.category || '-'}</td>
              <td style="padding: 8px; color: ${e.type === 'Income' ? '#4ade80' : '#f87171'};">${e.type}</td>
              <td style="padding: 8px;">$${e.amount.toFixed(2)}</td>
              <td style="padding: 8px;"><button onclick="deleteEntry(${e.id})">Delete</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("entry-form")?.addEventListener("submit", handleAddEntry);
}