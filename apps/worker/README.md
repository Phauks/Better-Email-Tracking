# @bet/worker

Cloudflare Worker (Hono + D1) that serves the open pixel (`/o/:id.gif`), the click
redirect (`/c/:id/:idx`) and the authenticated `/api/*` used by the extension.

## Layout

- `src/index.ts`: Worker entry (`fetch` + `scheduled`, every 15 minutes)
- `src/app.ts`: `createApp(deps)` wires store, config, CORS and auth, then mounts modules
- `src/modules.ts`: feature module list. Add a `TrackerModule` here to add routes or cron work
- `src/routes/`: `tracking.ts` (pixel/click), `api.ts` (JSON API)
- `src/services/`: event recording and own-open suppression, summaries, retention
- `src/store/`: `Store` interface, `D1Store` (production), `MemoryStore` (tests)
- `src/nudges/`: follow-up nudges module (routes, scheduler `runner.ts`, send windows, its own `NudgeStore`)
- `src/connectors/`: `MailboxConnector` interface, Gmail implementation, Google OAuth, MIME builder, `FakeMailbox` for tests
- `migrations/`: D1 schema

## Setup and deploy

```sh
cd apps/worker
npx wrangler login
npx wrangler d1 create bet            # copy database_id into wrangler.toml
npx wrangler d1 migrations apply bet --remote
npx wrangler secret put API_TOKEN     # long random string; paste the same into the extension
npx wrangler secret put IP_SALT       # another random string
npx wrangler deploy
```

Generate random values with `openssl rand -base64 32`.

**Custom subdomain (recommended):** with your domain on Cloudflare, uncomment the
`routes` block in `wrangler.toml`, set `pattern = "t.yourdomain.com"`, and deploy again.
Cloudflare creates the DNS record and certificate. Use `https://t.yourdomain.com` as the
tracker URL in the extension.

## Follow-up nudges (optional)

The Worker sends follow-ups itself, so they go out while your computer is off. It needs
access to your Gmail through Google's API, with two narrow scopes: `gmail.send` (send
mail) and `gmail.metadata` (read headers such as From/Date/Message-ID to spot replies;
never message bodies). Setup takes about ten minutes:

1. **Google Cloud project.** At <https://console.cloud.google.com/> create a project
   (any name).
2. **Enable the Gmail API.** APIs & Services → Library → "Gmail API" → Enable.
3. **OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access).
   User type **External**, app name of your choice, your email as support and developer
   contact. Add the scopes `https://www.googleapis.com/auth/gmail.send` and
   `https://www.googleapis.com/auth/gmail.metadata`. Add yourself as a test user.
4. **Publish the app.** On Audience, click **Publish app** so its status is **In
   production**. Apps left in **Testing** get refresh tokens that expire after 7 days,
   which would silently stop your follow-ups. (This is Google's documented behaviour at
   the time of writing; check the current "Testing" publishing-status notes in Google's
   OAuth documentation.) You don't need Google's verification for personal use: when
   you connect, Google shows a **"Google hasn't verified this app"** warning; click
   **Advanced → Go to (your app)**. An unverified app is capped at 100 users, which is
   plenty for one. Verify the current limits in Google's docs.
5. **OAuth client.** Clients → Create client → **Web application**. Add the authorized
   redirect URI `https://<your worker host>/oauth/google/callback` (exactly the host the
   extension uses, e.g. `https://t.yourdomain.com/oauth/google/callback`). Copy the
   client id and secret.
6. **Secrets and migration.**

   ```sh
   npx wrangler d1 migrations apply bet --remote   # adds the nudge tables
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put TOKEN_ENC_KEY           # openssl rand -base64 32
   npx wrangler deploy
   ```

   Optional: `GOOGLE_REDIRECT_URI` if Google must call back on a different origin than
   the one the extension talks to.
7. In the extension options, under **Follow-ups**, click **Connect Gmail** and approve.

How it works:

- The refresh token is stored in D1 encrypted with AES-256-GCM (key derived from
  `TOKEN_ENC_KEY` with HKDF). Access tokens are fetched on demand and never stored. The
  OAuth `state` is HMAC-signed and expires after 10 minutes. **Disconnect** revokes the
  token at Google and deletes it.
- The cron runs every 15 minutes. For each due sequence it reads the thread's headers:
  a message after your send from anyone but you stops the sequence (`replied`, and a
  `reply` event appears in the feed). Out-of-office auto-replies (`Auto-Submitted`) are
  ignored; a bounce from `mailer-daemon` marks it `failed`. Otherwise it sends the next
  nudge as a reply (`In-Reply-To`/`References` from the newest message, same `threadId`,
  `Re:` subject) and records a `nudge_sent` event. Nudge and reply events never count
  as opens or clicks.
- Each nudge is registered as its own tracked message (mode `shared`, `groupId` = the
  original's group or id), so opens of the nudge are tracked too.
- Safety: sequences are claimed with a 10-minute lease (conditional `UPDATE`), each one
  is processed in its own try/catch with exponential backoff (gives up after 6 errors),
  and a pending-send marker plus an `X-BET-Nudge-Id` header let a retry see whether a
  nudge already went out, so a crash never double-sends.
- Optional send window (local hours, weekdays) per sequence; the extension sends your
  default and time zone.
- Retention purges once a day (the 03:00 UTC run) and also removes finished sequences.

API (bearer auth): `POST/GET /api/nudges`, `GET/PATCH/DELETE /api/nudges/:id`
(`PATCH {action: "pause" | "resume", steps?, stopOnOpen?, sendWindow?}`),
`GET /api/connectors/status`, `POST /api/connectors/google/start`,
`DELETE /api/connectors/google`. Public: `GET /oauth/google/callback`. Types are in
`packages/shared/src/nudges.ts`.

Other providers: implement `MailboxConnector` (`findReplies`, `sendReply`) in
`src/connectors/`, add it to `resolveConnector` in `registry.ts`, and add its OAuth
routes next to Google's.

## Settings (`[vars]` in wrangler.toml)

| Var                    | Default   | Meaning                                                                   |
| ---------------------- | --------- | ------------------------------------------------------------------------- |
| `SEND_GRACE_SECONDS`   | 20        | Ignore events this soon after sending (your own client loading the pixel) |
| `OWNER_WINDOW_SECONDS` | 45        | Ignore events this soon after you viewed the message                      |
| `RETENTION_DAYS`       | 180       | Daily purge (03:00 UTC run) deletes older data (0 disables)               |
| `STORE_LOCATION`       | `"false"` | `"true"` stores coarse city/country                                       |
| `ALLOWED_ORIGINS`      | unset     | Extra CORS origins, comma-separated (extension origins always allowed)    |

Raw IPs are never stored, only a salted, truncated SHA-256.

## Local dev

```sh
printf 'API_TOKEN=dev\nIP_SALT=dev\n' > .dev.vars
npx wrangler d1 migrations apply bet --local
npx wrangler dev
```

Trigger the cron locally with `npx wrangler dev --test-scheduled` and
`curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"`.

Tests (from repo root): `npx vitest run apps/worker`.
