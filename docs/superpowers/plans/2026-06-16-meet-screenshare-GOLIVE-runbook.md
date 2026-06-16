# Go-Live Runbook — Meeting bot "sees" the shared screen

**Who does what:** I (Claude) write and test 100% of the code. **You do nothing technical until
this runbook.** This is the only part that needs your hands, and only because it uses *your*
Fly.io and Vercel accounts. Every command below is copy-paste, and I tell you exactly what you
should see after each one. Budget ~20–30 minutes.

**If anything looks different from what I describe, stop and send me a screenshot.** Don't push past
a red error.

> Prefer not to touch the terminal at all? Tell me and I'll do Part B (Vercel) for you, and I'll
> walk you through Part A live, one line at a time.

---

## Plain-English: what we're switching on

The meeting bot already hears the call. To give it *eyes* on a shared screen, it needs a tiny
"helper" program running on the internet 24/7. Our main app (on Vercel) can't keep that kind of
always-open connection, so the helper lives on a cheap service called **Fly.io** (~$2–5/month).

Three steps: **A)** put the helper online, **B)** tell the main app where it is, **C)** test it on a
real Google Meet.

---

## Part A — Put the helper online (Fly.io)

1. **Open the Terminal app** (press ⌘-Space, type "Terminal", hit Enter).

2. **Install Fly's tool.** Copy-paste this line and press Enter:
   ```
   brew install flyctl
   ```
   - If it says `brew: command not found`, use this instead:
     ```
     curl -L https://fly.io/install.sh | sh
     ```
   - ✅ Done when it finishes with no red "error" lines.

3. **Sign in to Fly.** Copy-paste:
   ```
   fly auth signup
   ```
   - Your browser opens — create the account (a card is required; the worker is ~$2–5/mo).
   - Already have a Fly account? Use `fly auth login` instead.
   - ✅ Done when the terminal says `successfully logged in as <your email>`.

4. **Go to the helper's folder.** Copy-paste:
   ```
   cd ~/Documents/conversationalAI/ghl-agent/recall-video-worker
   ```
   - ✅ Done when the prompt changes and shows no error.

5. **Create the app on Fly (first time only).** Copy-paste:
   ```
   fly launch --no-deploy
   ```
   - It asks a few questions. Accept the defaults **except**:
     - App name → type: `voxility-recall-worker`
     - Region → choose: `sjc` (San Jose)
     - If it asks about a **database / Postgres / Redis / Tigris** → say **No** to all.
   - ✅ Done when it says the app was created and config written, no red errors.

6. **Put it online.** Copy-paste:
   ```
   fly deploy
   ```
   - Takes ~2–3 minutes. ✅ Done when you see something like `1 desired, 1 placed, 1 healthy`.

7. **Confirm it's alive.** Copy-paste:
   ```
   curl https://voxility-recall-worker.fly.dev/healthz
   ```
   - ✅ Done when it prints: `ok rooms=0`
   - ❌ If it hangs or errors, wait 30s and try once more. Still failing? Run `fly logs` and send me
     what it shows.

---

## Part B — Tell the main app where the helper is (Vercel)

**Easiest way (clicks, no terminal):**

1. Go to **vercel.com** → your project (**voxilityai**) → **Settings** → **Environment Variables**.
2. Click **Add New** and fill in:
   - **Key:** `RECALL_VIDEO_WORKER_WS_HOST`
   - **Value:** `voxility-recall-worker.fly.dev`  ← just the address, no `https://`, no spaces
   - **Environments:** tick **Production** and **Development**.
3. Click **Save**.
4. Go to the **Deployments** tab → on the most recent Production deployment, click the **⋯** menu →
   **Redeploy** → confirm. Wait for it to turn green (~2–3 min). This makes the new setting take effect.

> Want me to do Part B for you instead? Say "do the Vercel part" and I'll set the variable and
> redeploy — then you only do Parts A and C.

---

## Part C — Test it on a real Google Meet

1. Start a meeting: **meet.google.com → New meeting → Start an instant meeting.** Leave the tab open.
2. In Voxility, send the meeting bot to that Meet link (the same way you did before). **Admit the bot**
   when it asks to join.
3. In the Meet, **share your screen**: click **Present now → A tab** (or window) and pick something.
4. **Watch it work:** within a few seconds the bot should start referring to what's on your shared
   screen — e.g. "looks like you're on the settings page — …". 🎉
5. (Optional, to see it under the hood) back in Terminal run:
   ```
   fly logs
   ```
   You'll see a line like `first recall payload …` followed by a steady trickle — that's screen
   frames flowing.
6. **Stop sharing**, then ask the bot "what's on my screen now?" → it should say it can't see a
   screen and ask you to share. That's the correct behavior.

---

## If something's off (send me this)

- **Bot joins and talks, but never mentions the screen** → run `fly logs`, copy the line that starts
  with `first recall payload`, and send it to me. That line tells me if the screen data looks the way
  I expected; if not, it's a ~5-minute fix on my side.
- **The health check (`/healthz`) fails** → run `fly status` and send me what it shows.
- **Anything red you don't understand** → screenshot it and send it over. Don't continue past it.

That's the whole thing. Once Part C works, the feature is live for every meeting bot automatically.
