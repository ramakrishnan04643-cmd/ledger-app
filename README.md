# Personal Ledger

A private, local, single-user app for tracking:
- **People who owe you monthly payments** — amount you gave them, monthly due amount, due date, payment status (Completed / Partial / Pending / Overdue), full history with notes, one-click "mark completed," per-person Excel export, archive or permanently delete.
- **Your own expenses** — categorized (with your own custom categories), with a monthly total.
- **Overview dashboard** — notifications for due/overdue payments (in-app and, if enabled, real phone push), quick add/remove for people, net worth (cash + money out on loan), a savings goal tracker, and a savings log with notes.
- **Financial year summary** — total collected vs. spent, by category (Apr–Mar, Indian FY).
- **One-click backup** — exports everything to a JSON file you keep yourself.
- **Phone notifications** — a daily digest push notification for anyone overdue or due soon, delivered even if the app isn't open.

Everything lives in a single SQLite file (`backend/ledger.db`) on your machine. Nothing is sent anywhere else except push notifications, which route through your browser's push service (Google/Mozilla/etc.) the same way any website's notifications do — the message itself is end-to-end encrypted so only your device can read it. The app is protected by a password you set on first run.

## Run it locally

```bash
cd ledger-app/backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt   # (Windows: venv\Scripts\pip install -r requirements.txt)

# Optional but recommended — keeps you logged in across restarts:
cp .env.example .env
# then edit .env and set LEDGER_SECRET_KEY to any long random string

./venv/bin/uvicorn main:app --reload --port 8420   # (Windows: venv\Scripts\uvicorn main:app --reload --port 8420)
```

Open **http://127.0.0.1:8420** in your browser. The first time, you'll be asked to set a password — that's your app lock going forward.

## Setting up phone notifications

1. Open the app **over HTTPS** — plain `http://` only works on `localhost`. If you're using Tailscale, run `tailscale serve https / http://localhost:8420` on your PC and open the `https://your-machine.tailXXXX.ts.net` address it gives you, instead of the bare IP.
2. On the **Overview** tab, tap **🔔 Enable** and accept the browser's permission prompt.
3. Tap **Send test** to confirm a notification actually reaches your phone.
4. From then on, a background job on the server checks once a day (default 9:00 AM — change with `LEDGER_NOTIFY_HOUR` in `.env`) and sends a digest notification for anyone overdue or due within 2 days.

This only works while the server is running (see the "PC being off" note further down) — the daily check happens *on the server*, not your phone.

## Project structure

```
backend/
  main.py         FastAPI routes (auth, people, payments, expenses, categories, savings log, push, dashboard, summary, backup)
  models.py       SQLAlchemy tables: Person, PersonPayment, ExpenseCategory, SavingsEntry, Expense, Settings, PushSubscription
  schemas.py      Pydantic request/response shapes
  auth.py         Password hashing + signed-cookie sessions
  push.py         VAPID key management + Web Push sending
  database.py     SQLite engine/session setup
  vapid_keys.json Auto-generated on first run — DO NOT delete or every phone's subscription breaks
  ledger.db       Created automatically on first run — this is all your data
frontend/
  index.html, style.css, app.js, service-worker.js, manifest.json, icons/    Plain HTML/CSS/JS — no build step needed
```

## How the pieces work

- **Monthly rows auto-create.** Every time you load the dashboard or people list, the app checks each active person and creates this month's due row if it doesn't exist yet (based on their `due_day`).
- **Payments are additive**, and each can carry a note and an entry date. "Mark completed" is a separate one-click action that sets the month to fully paid regardless of what's been logged — for when you've settled up in person and don't want to do the amount math.
- **Categories** are stored in the database, not hardcoded — add your own from the Expenses tab any time.
- **Savings log** is a simple running list of amount + note entries, separate from the single current/goal figures on the dashboard — a place to jot "put aside ₹5,000 this month, bonus from client work."
- **Archiving** sets a flag and preserves history; **deleting** a person is permanent and asks for confirmation first.
- **Push notifications** use the standard Web Push protocol (VAPID) — no third-party service, no account. `vapid_keys.json` is generated once and must stay put, or every phone's subscription silently breaks and needs re-enabling.

## Things worth adding yourself later

- **Automatic backups.** The export button is manual. You could wire it to run on a schedule and drop the file into a synced folder (Google Drive desktop, etc.).
- **Multi-device access.** If you ever want to check this from your phone too without Tailscale, you'd deploy it (e.g. Render, like your other app) instead of running it only on localhost — at that point, strongly consider swapping SQLite for hosted Postgres and keeping HTTPS on.

