# Personal Ledger

A private, local, single-user app for tracking:
- **People who owe you monthly payments** — amount you gave them, monthly due amount, due date, payment status (Completed / Partial / Pending / Overdue), full history, archiving once settled.
- **Your own expenses** — categorized, with a monthly total.
- **Overview dashboard** — notifications for due/overdue payments, net worth (cash + money out on loan), and a savings goal tracker.
- **Financial year summary** — total collected vs. spent, by category (Apr–Mar, Indian FY).
- **One-click backup** — exports everything to a JSON file you keep yourself.

Everything lives in a single SQLite file (`backend/ledger.db`) on your machine. Nothing is sent anywhere else. The app is protected by a password you set on first run.

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

## Project structure

```
backend/
  main.py        FastAPI routes (auth, people, payments, expenses, dashboard, summary, backup)
  models.py       SQLAlchemy tables: Person, PersonPayment, Expense, Settings
  schemas.py      Pydantic request/response shapes
  auth.py         Password hashing + signed-cookie sessions
  database.py     SQLite engine/session setup
  ledger.db       Created automatically on first run — this is all your data
frontend/
  index.html, style.css, app.js    Plain HTML/CSS/JS — no build step needed
```

## How the pieces work

- **Monthly rows auto-create.** Every time you load the dashboard or people list, the app checks each active person and creates this month's due row if it doesn't exist yet (based on their `due_day`). You never have to manually roll over months.
- **Payments are additive.** "Record payment" adds to whatever's already been paid that month, so partial payments across multiple visits accumulate correctly.
- **Status logic** (`main.py::payment_status`): overdue if past due date with nothing paid, due-soon if within 2 days, partial if some-but-not-all paid, paid if fully covered.
- **Archiving** just sets a flag — history is preserved, the person drops out of active lists, dashboards, and totals.
- **Net worth** = your cash balance (you enter this manually — it's not something the app can know) + total outstanding principal across active people.

## Things worth adding yourself later

- **Real reminders.** Right now notifications only show when you open the app. For actual before-the-fact nudges, you'd add a scheduled job (e.g. a daily cron calling a new `/api/reminders/check` endpoint) that sends you a Telegram or email alert — that needs a bot token / SMTP credentials you'd manage separately.
- **Automatic backups.** The export button is manual. You could wire it to run on a schedule and drop the file into a synced folder (Google Drive desktop, etc.).
- **Multi-device access.** If you ever want to check this from your phone too, you'd deploy it (e.g. Render, like your other app) instead of running it only on localhost — at that point, strongly consider swapping SQLite for hosted Postgres and keeping HTTPS on.
