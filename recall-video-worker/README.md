# recall-video-worker

Relays a Recall.ai bot's real-time screenshare frames into the Voxility meeting-bot page so the
live Gemini session can see the shared screen.

- `wss://<host>/recall/:botToken` — Recall pushes `video_separate_png.data` here.
- `wss://<host>/agent/:botToken` — the bot page connects here; receives `{type:'frame',mime,data,ts}`.

Paired by `botToken`. Screenshare frames only; identical frames deduped. No durable state.

## Local

```bash
npm install
npm test
npm run dev   # listens on :8080; GET /healthz → "ok rooms=0"
```

## Deploy (Fly.io)

```bash
fly launch --no-deploy   # first time only; app name voxility-recall-worker, region sjc, no DB
fly deploy
```

Then set `RECALL_VIDEO_WORKER_WS_HOST=voxility-recall-worker.fly.dev` in the ghl-agent (Vercel) env
(Production + Development) and redeploy. Full non-technical walkthrough:
`../docs/superpowers/plans/2026-06-16-meet-screenshare-GOLIVE-runbook.md`.
