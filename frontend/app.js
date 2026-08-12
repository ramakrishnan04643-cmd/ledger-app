// Standalone Client-Side app.js (No Backend Required)

const state = {
  passwordSet: false,
  authed: false
};

document.addEventListener("DOMContentLoaded", () => {
  // Check if a password hash is stored in local storage
  state.passwordSet = !!localStorage.getItem("ledger_password_hash");
  render();
});

// Simple client-side SHA-256 hash helper
async function hashPassword(password) {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function handleAuthSubmit(e) {
  if (e) e.preventDefault();

  const input = document.getElementById("pw-input");
  const errContainer = document.getElementById("auth-error");
  if (!input || !input.value) return;

  const enteredPassword = input.value;

  if (!state.passwordSet) {
    // Create new password
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
    // Verify existing password
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

  // Dashboard View Once Unlocked
  root.innerHTML = `
    <div class="ledger-dashboard">
      <header>
        <h1>Private Ledger</h1>
        <button onclick="localStorage.removeItem('ledger_password_hash'); location.reload();">Reset Password</button>
        <button onclick="location.reload();">Lock</button>
      </header>
      <main>
        <p>Welcome! Your private ledger is unlocked.</p>
      </main>
    </div>
  `;
}