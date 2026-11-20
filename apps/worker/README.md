# @bet/worker

Cloudflare Worker (Hono + D1) that serves the open pixel (`/o/:id.gif`), the click
redirect (`/c/:id/:idx`), tracked documents (`/d/:docId/:messageId`) and the
authenticated `/api/*` used by the extension.

## Layout

- `src/index.ts`: Worker entry (`fetch` + daily `scheduled`)
- `src/app.ts`: `createApp(deps)` wires store, config, CORS and auth, then mounts modules
- `src/modules.ts`: feature module list. Add a `TrackerModule` here to add routes or cron work
- `src/routes/`: `tracking.ts` (pixel/click), `api.ts` (JSON API)
- `src/services/`: event recording and own-open suppression, summaries, retention
- `src/store/`: `Store` interface, `D1Store` (production), `MemoryStore` (tests)
- `src/documents/`: tracked documents module (own `DocumentStore`, R2 `ObjectStore`, viewer page)
- `src/campaigns/`: mail merge module with its own `CampaignStore` (D1 + memory), routes, stats
- `migrations/`: D1 schema

## Setup and deploy

```sh
cd apps/worker
npx wrangler login
npx wrangler d1 create bet            # copy database_id into wrangler.toml
npx wrangler d1 migrations apply bet --remote
npx wrangler r2 bucket create bet-docs  # tracked documents (binding DOCS in wrangler.toml)
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
| `DOCS_MAX_MB`          | 25        | Upload limit for tracked documents                                        |

Raw IPs are never stored, only a salted, truncated SHA-256.

## Tracked documents

Files live in the R2 bucket bound as `DOCS` (rename `bucket_name` in `wrangler.toml` if
you like; uploads answer 503 until a bucket is bound). Metadata and views are in D1
(`migrations/0002_documents.sql`).

| Route                                  | Auth   | What                                                                           |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `POST /api/documents?name=<file name>` | bearer | Upload (raw body with `Content-Type`, or multipart field `file`). `{id, url}`  |
| `GET /api/documents`                   | bearer | List with views, unique viewers, downloads, total reading time                 |
| `GET /api/documents/:id`               | bearer | Per-recipient rows, per-page reading time, activity                            |
| `GET /api/documents/:id/file`          | bearer | Owner preview; never counted                                                   |
| `POST /api/documents/attach`           | bearer | `{messageId, documentIds}`: which documents a message links to                 |
| `DELETE /api/documents/:id`            | bearer | Deletes the object, its rows and its feed entries                              |
| `GET /d/:docId[/:messageId]`           | none   | Viewer: pdf.js (cdnjs, pinned in `src/documents/viewer.ts`) or a download page |
| `GET /d/:docId[/:messageId]/file`      | none   | The file, `no-store`; `?download=1` for an attachment                          |
| `POST /d/:docId[/:messageId]/events`   | none   | Viewer beacons: `view`, `page` (dwell per page), `download`; 8 KB cap          |

The extension inserts `/d/<docId>`; at send time instrumentation rewrites it to
`/d/<docId>/<messageId>`, so a view names its message, and in individual mode its
recipient. Views run through the same classification and own-open suppression as
opens (send grace, owner window, owner IP); page and download beacons inherit the
classification of their view. Views of a tracked message also land in the events
table as `doc_view`, so they show up in `/api/feed` but never change open or click
counts. The daily cron purges document events older than `RETENTION_DAYS` and
documents uploaded before then, with their R2 objects.

## Mail merge campaigns

Migration `0004_campaigns.sql` adds `campaigns` and `campaign_recipients`. The Worker only
keeps the queue; the extension sends each copy from the user's mail tab. A campaign's id is
the `groupId` of every copy it sends, so engagement comes from the normal message and event
summaries.

| Route                                              | What                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/campaigns`                              | Create with templates, settings and recipients (`draft` or `sending`) |
| `GET /api/campaigns?status=&limit=`                | List with stats: sent, opened, clicked, machine-only, unopened        |
| `GET /api/campaigns/:id`                           | Detail with each recipient's state and tracking status                |
| `PATCH /api/campaigns/:id`                         | `{ action: start \| pause \| resume \| cancel \| retry, reason? }`    |
| `DELETE /api/campaigns/:id`                        | Delete the campaign (tracked messages are kept)                       |
| `POST /api/campaigns/:id/lease`                    | `{ runnerId, ttlMs }`: one sending tab at a time (409 if taken)       |
| `POST /api/campaigns/:id/recipients/:email/result` | `{ state: sending \| sent \| failed \| skipped, messageId?, error? }` |

Recipient states are `queued`, `sending` (claimed; only from `queued`, so a copy is never
claimed twice), `sent`, `failed` and `skipped`. A campaign becomes `done` when nothing is
queued or in flight. A `sending` recipient whose message was marked sent is reconciled to
`sent` on the next read. The daily cron deletes campaigns not updated within
`RETENTION_DAYS`.

## Local dev

```sh
printf 'API_TOKEN=dev\nIP_SALT=dev\n' > .dev.vars
npx wrangler d1 migrations apply bet --local
npx wrangler dev
```

Tests (from repo root): `npx vitest run apps/worker`.
