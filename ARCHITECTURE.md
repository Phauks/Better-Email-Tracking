# Architecture

Three packages, one contract:

```
packages/shared   provider-neutral HTTP contract (types + route builders), HTML
                  instrumentation, request classification, mail merge and nudge
                  template logic. Pure TypeScript: runs in the Worker, the extension
                  and tests.
apps/worker       Cloudflare Worker (Hono, D1, R2). Pixel, click redirect, document
                  viewer, the bearer-token /api/*, OAuth callback, cron.
apps/extension    Chrome MV3 extension (Svelte 5, Vite). Content script inside the mail
                  client, background service worker, popup / options / dashboard pages.
```

Each user-facing feature (core tracking, tracked documents, mail merge, follow-ups) is a
module in **both** apps plus a file in `packages/shared` for its API types. The apps
never import each other; they meet only through `@bet/shared`.

## Worker

```
src/index.ts          fetch + scheduled entry
src/app.ts            createApp(deps, modules): config, core store, CORS + auth on /api/*,
                      then each module's register(app). runScheduled: daily hooks on the
                      03:00 UTC run, then every module's scheduled hook.
src/modules.ts        the module list
src/types.ts          TrackerModule, ScheduledContext, DailyContext, AppEnv
src/core/             message tracking (tracking.ts, api.ts, events.ts, summary.ts,
                      retention.ts, validate.ts, store/)
src/features/<name>/  documents/, campaigns/, nudges/
src/connectors/       server-side mailbox access (MailboxConnector; Gmail today)
src/lib/              shared helpers: parse.ts (request parsing), d1.ts (query helpers),
                      auth, CORS, hashing, crypto, deferred work
migrations/           D1 schema, applied in order (NNNN_name.sql)
```

A module is:

```ts
interface TrackerModule {
	name: string;
	register?(app: App): void; // routes; /api/* is already authed
	scheduled?(ctx: ScheduledContext): Promise<void>; // every cron run (15 min)
	daily?(ctx: DailyContext): Promise<void>; // once a day; ctx.purgeBefore set
} // unless RETENTION_DAYS=0
```

Every feature folder has the same shape:

```
index.ts       createXModule(overrides: Partial<XDeps>) + the default instance.
               XDeps.store(env) builds the D1 store; tests pass a memory store.
routes.ts      Hono routes (owner API, and any public routes)
validate.ts    request parsers returning Parsed<T> (helpers in lib/parse.ts)
store/types.ts the store interface and stored row types
store/d1.ts    production store (helpers in lib/d1.ts: chunks, placeholders, parseJson)
store/memory.ts in-memory store for tests
<name>.test.ts end-to-end tests through app.request() (see src/test-utils.ts)
```

Feature stores are separate from the core `Store` but may read it (for example, mail merge
reads the tracked messages of a campaign through `c.var.store`). A feature never imports
another feature's store. When one feature needs another's behaviour it goes through that
feature's `public.ts`: mail merge starts follow-ups through `FollowUpService`
(`features/nudges/public.ts`), injected as `CampaignsDeps.followUps(env, store)` so tests
can swap it.

### Lists and stats

List routes use keyset pagination (`packages/shared/src/pagination.ts`): rows ordered by
a stable key such as `(created_at DESC, id DESC)`, `limit + 1` fetched, `pageOf()` cuts
the page and encodes the last row's key as an opaque `nextCursor`, and `decodeCursor()`
checks a cursor's shape (a bad one is a 400). Page sizes come from `PAGE_LIMITS`.
Filters and search are part of the SQL, never applied to a page afterwards. Counts and
stats are SQL aggregates backed by indexes (migration 0006); each memory store computes
the same thing with the reference functions (`core/summary.ts`,
`features/documents/stats.ts`) and tests compare them. No query is unbounded.

### Adding a Worker feature

1. Add API types and route builders to `packages/shared/src/<name>.ts` and export them
   from `packages/shared/src/index.ts`.
2. Add a migration `apps/worker/migrations/NNNN_<name>.sql` (next number; never edit an
   applied one).
3. Create `apps/worker/src/features/<name>/` in the shape above. Use
   `daily({ purgeBefore })` for retention, `scheduled` for periodic work.
4. Append the module to `apps/worker/src/modules.ts`.
5. Test with `setup(env, (store) => [...modules, createXModule({ store: () => memory })])`
   from `src/test-utils.ts`.

## Extension

```
src/providers/     the mail-client boundary. MailClientAdapter (types.ts), catalog.ts
                   (names/labels, safe for pages), registry.ts (lazy adapters), gmail/.
                   Nothing outside this folder imports InboxSDK (except the background's
                   required "@inboxsdk/core/background.js").
src/features/      content-script modules ({ id, setup(ctx) }), ordered in features/index.ts
src/content/       content-script entry: picks the adapter, builds FeatureContext, runs features
src/background/    service worker: one handler map per feature, feed polling, notifications
src/messaging.ts   typed content -> background messages (core + each feature's messages.ts)
src/lib/channel.ts createChannel(): typed call/listen over chrome.runtime messages
src/api/client.ts  ApiClient, one section per module; apiFromSettings() builds it
src/ui/            pages (popup/, options/, dashboard/) and one folder per dashboard
                   view (emails/, documents/, mail-merge/, follow-ups/); shared
                   components/ and the single icons.ts registry (Phosphor)
src/lib/           pure, unit-tested helpers
```

Data flow: a content-script feature calls `callBackground({ type: "bet:..." })`; the
background handles it with `ApiClient`, which holds the token and has host permission.
Pages call the Worker directly with `pageApi()`.

### Adding an extension feature

1. Content script: `src/features/<name>/index.ts` exporting a `Feature`; add it to
   `src/features/index.ts`. Order matters for compose before-send hooks
   (individual-send must stay before compose-tracking). Use `ctx.adapter` for anything
   mail-client specific, `features/tracking.ts` to instrument and register a message,
   `features/send-copy.ts` to send one copy per recipient, and `onTrackedSent` from
   `features/sent-events.ts` to react to tracked sends.
2. Background calls: declare `XBgRequest` / `XBgResponseMap` in
   `src/features/<name>/messages.ts`, add them to the unions in `src/messaging.ts`, and
   put the handlers in `src/background/<name>.ts` (spread into `listenForBgRequests` in
   `background/index.ts`).
3. Worker endpoints: add a section to `ApiClient` in `src/api/client.ts`.
4. Dashboard view: `src/ui/<name>/<Name>.svelte`, then add it to `VIEWS` and the view
   switch in `src/ui/dashboard/Dashboard.svelte` (hash route `#<id>`). Use
   `components/ListState.svelte` for loading/error/empty states, `PagedList`
   (`ui/paged.svelte.ts`) with `components/LoadMore.svelte` for paginated lists, and the `.card` /
   `.list` / `.empty` / `.bad` classes from `theme.css`. Icons: import the Phosphor SVG
   in `src/ui/icons.ts` (keep it alphabetical) and use `<Icon name="..." />`.
5. Settings: add a typed field to `Settings` in `src/settings.ts` with a default and a
   normalizer (stored settings are normalized on every load, so old installs pick up
   the default).

### Adding a mail provider (Outlook, Yahoo, …)

1. Implement `MailClientAdapter` (`src/providers/types.ts`) in
   `src/providers/<name>/`: compose sessions with a cancellable before-send hook,
   `openCompose`, sent-list rows and message views. Return `undefined` or no-op where the
   client gives you nothing (for example `hasAttachments`).
2. Describe it in `src/providers/catalog.ts` and register it in
   `src/providers/registry.ts` (dynamic import, so its SDK stays out of other bundles).
3. Add its host to `host_permissions`, `content_scripts.matches` and (if needed)
   `web_accessible_resources` in `apps/extension/scripts/manifest.mjs`.

Features need no changes. Server-side follow-ups use a separate boundary: implement
`MailboxConnector` (`apps/worker/src/connectors/types.ts`), add it to
`connectors/registry.ts`, and add its OAuth flow next to `google-oauth.ts`.

## Checks

`pnpm check` runs Biome, the type checks (tsc, svelte-check) and Vitest. `pnpm build`
builds the extension into `apps/extension/dist` and dry-runs the Worker deploy.
