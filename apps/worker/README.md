# @bet/worker

Cloudflare Worker (Hono + D1) that serves the open pixel (`/o/:id.gif`), the click
redirect (`/c/:id/:idx`) and the authenticated `/api/*` used by the extension.

## Layout

- `src/index.ts`: Worker entry (`fetch` + daily `scheduled`)
- `src/app.ts`: `createApp(deps)` wires store, config, CORS and auth, then mounts modules
- `src/modules.ts`: feature module list. Add a `TrackerModule` here to add routes or cron work
- `src/routes/`: `tracking.ts` (pixel/click), `api.ts` (JSON API)
- `src/services/`: event recording and own-open suppression, summaries, retention
- `src/store/`: `Store` interface, `D1Store` (production), `MemoryStore` (tests)
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

## Settings (`[vars]` in wrangler.toml)

| Var                    | Default   | Meaning                                                                   |
| ---------------------- | --------- | ------------------------------------------------------------------------- |
| `SEND_GRACE_SECONDS`   | 20        | Ignore events this soon after sending (your own client loading the pixel) |
| `OWNER_WINDOW_SECONDS` | 45        | Ignore events this soon after you viewed the message                      |
| `RETENTION_DAYS`       | 180       | Daily cron deletes older data (0 disables)                                |
| `STORE_LOCATION`       | `"false"` | `"true"` stores coarse city/country                                       |
| `ALLOWED_ORIGINS`      | unset     | Extra CORS origins, comma-separated (extension origins always allowed)    |

Raw IPs are never stored, only a salted, truncated SHA-256.

## Local dev

```sh
printf 'API_TOKEN=dev\nIP_SALT=dev\n' > .dev.vars
npx wrangler d1 migrations apply bet --local
npx wrangler dev
```

Tests (from repo root): `npx vitest run apps/worker`.
