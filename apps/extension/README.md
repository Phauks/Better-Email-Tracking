# Better Email Tracking: Chrome extension

A Manifest V3 extension that adds open and click tracking to Gmail and talks to
your own tracking Worker (`apps/worker`). It is built with TypeScript, Svelte 5,
Vite, [InboxSDK](https://www.inboxsdk.com/) for Gmail, and
[Phosphor](https://phosphoricons.com/) icons.

## Build and load

1. Get an InboxSDK app id. It's free: register at <https://www.inboxsdk.com/register>.
   Copy `.env.example` to `.env` and set `VITE_INBOXSDK_APP_ID`. The build warns if
   it's missing, and the Gmail integration won't start without it.
2. Build from the repo root with `pnpm --filter @bet/extension build`. For a watch
   build, run `pnpm --filter @bet/extension dev`.
3. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick
   `apps/extension/dist`.
4. The options page opens on install. Enter your Worker URL (for example
   `https://track.example.com`) and API token, then click **Save**. Chrome asks for
   access to that host. Click **Test connection** to check `/api/health` and an
   authenticated endpoint.

`node scripts/icons.mjs` regenerates `public/icons/*.png` from the Phosphor
`envelope-simple-open` glyph. It uses Playwright and Chromium.

## Settings

All settings live in `chrome.storage.sync`. See `src/settings.ts` for the types and defaults.

| Setting              | Default  | Meaning                                                                                              |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `workerUrl`          | (empty)  | Base URL of the Worker. It also serves `/o/:id.gif` and `/c/:id/:i`.                                 |
| `apiToken`           | (empty)  | Bearer token for `/api/*`.                                                                           |
| `defaultMode`        | `shared` | Starting mode for new emails: `off`, `shared` ("Track") or `individual` ("Track each recipient").    |
| `trackLinks`         | `true`   | Rewrite http(s) links through the click redirect. Unsubscribe and opt-out links are never rewritten. |
| `notify`             | `true`   | Show desktop notifications for opens and clicks.                                                     |
| `notifyMachineOpens` | `false`  | Also notify for Apple privacy proxy and scanner opens.                                               |
| `neverTrackDomains`  | `[]`     | If any recipient is on one of these domains (subdomains included), the email goes out untracked.     |

## Features

- **Compose control.** An eye icon in the compose toolbar cycles through
  Track, Track each recipient and Off. When you click Send, the extension adds the
  pixel and rewrites links, registers the message with the Worker, then sends. If
  registration fails, the email still goes out, untracked, and Gmail shows a notice.
- **Track each recipient.** This sends one copy per recipient, each with its own
  tracker. The copies share a `groupId`.
- **Own-open suppression.** When you view your own tracked mail, the extension
  reports those pixel ids to `/api/owner-views` right away and removes the pixel
  images. This also catches Gmail-proxied `googleusercontent.com/...#https://...` URLs.
- **List badges.** Rows in thread lists get a status icon. Lookups are batched
  through `/api/thread-status` and cached for 60s:
  - gray check: not opened
  - pale check: opened by a mail privacy proxy, may not be read
  - green double check: opened
  - blue cursor: link clicked
- **Background service worker.** Polls `/api/feed` every minute, shows
  notifications, and keeps an unread count on the toolbar badge. The count clears
  when you open the popup.
- **Popup and dashboard.** The popup shows recent activity. The dashboard is a
  full tab with search, a status filter, individual sends grouped per recipient,
  and an event timeline that labels each event's source (Gmail proxy, Apple
  privacy proxy, scanner, direct) and device.

- **Mail merge.** The dashboard's **Mail merge** view sends one personalised,
  individually tracked email per row of a CSV. See below.

### Mail merge

1. **Recipients.** Paste CSV or upload a file. The header row names the columns. Quotes,
   `""` escapes, line breaks inside quotes, CRLF, `;`/tab separators and an Excel BOM are
   handled. Pick which column is the email address and which is the name. Every other
   column becomes a field (rename or ignore it). Invalid addresses and duplicates
   (case-insensitive) are left out and listed.
2. **Compose.** Subject and body take `{{field}}` and `{{field|fallback}}`. The body is a
   plain textarea: line breaks are kept, and simple HTML such as `<b>` or `<a href>` is
   allowed. Field values are HTML-escaped. `first_name` is derived from the name when no
   column provides it.
3. **Preview** each recipient's rendered email. Choose what happens when a field is empty:
   skip that recipient (default) or send with a blank.
4. **Send settings.** Random wait between emails (default 20 to 40 s), a per-run cap
   (default 50, after which the campaign pauses until you resume it) and link tracking.

Sending runs in an open Gmail tab, through the same per-copy pipeline as "Track each
recipient" (`features/send-copy.ts`): each copy gets its own message id and
`groupId = campaign id`, is registered, sent through a compose window, confirmed and marked
sent. The queue lives in the Worker, so closing or reloading Gmail just pauses sending;
the next Gmail tab picks it up. If several Gmail tabs are open, a lease on the Worker lets
only one send. A copy that was in flight when the tab closed is marked failed with a note
to check your Sent folder (never resent automatically). After three failures in a row the
campaign pauses.

The campaign list shows live progress and each recipient's status with the same icons as
the sent list. You can pause, resume, cancel or retry failed recipients. **Follow up with
non-openers** starts a new draft for recipients who have not opened, or were only opened
by a privacy proxy.

Gmail limits how many emails and recipients you can send per day, and the limits depend
on the account type. See Google's pages for
[personal Gmail](https://support.google.com/mail/answer/22839) and
[Google Workspace](https://support.google.com/a/answer/166852). Recipients on your
never-track list still get the email, without tracking.

### The "Track each recipient" tradeoff

To know exactly who opened, the extension has to send separate emails. So:

- Recipients no longer see each other. Each copy is addressed only to that person.
- CC and BCC recipients become separate emails addressed **To** them.
- Replies are not split, because the copies would leave the thread. Emails with
  attachments are not split either, including when the extension can't tell
  whether there are any. In those cases the email is sent once with shared
  tracking, and a notice explains why.
- Copies are sent one after another, and then the original draft is discarded. If
  a copy fails partway through, the original draft stays open and a notice lists
  who did not get it.

The compose tooltip and the options page both explain this.

## Architecture

```
src/
  providers/        mail-client adapters (the only code that may import InboxSDK)
    types.ts        MailClientAdapter / ComposeSession / ListRow / MessageViewInfo
    registry.ts     picks an adapter by location.hostname
    gmail/          InboxSDK implementation
  features/         content-script modules: { id, setup(ctx) }, listed in features/index.ts
    compose-tracking/  individual-send/  own-open/  sent-status/  mail-merge/
    send-copy.ts    per-copy send pipeline shared by individual-send and mail-merge
  content/          content-script entry; builds the FeatureContext
  background/       service worker: API proxy, feed polling, notifications, badge
  messaging.ts      typed content -> background message union
  api/client.ts     typed Worker client (background and extension pages)
  settings.ts       typed chrome.storage.sync settings with defaults
  lib/              pure, unit-tested logic (status badges, feed text, grouping, domains)
  ui/               Svelte 5 pages (popup, options, dashboard), icons.ts, Icon.svelte
    mail-merge/     dashboard Mail merge view (builder, campaign list and detail)
```

Content scripts never call the Worker directly. They send typed messages
(`src/messaging.ts`) to the background, which holds the token and the host permission.

### Adding a feature

Create `src/features/<name>/index.ts` that exports a `Feature` (`{ id, setup(ctx) }`),
then add it to the list in `src/features/index.ts`. `ctx` gives you the adapter, the
API, current settings and the tracking URL builders. Shared send helpers, such as
instrumenting HTML and building the register request, are in `src/features/tracking.ts`,
so later modules like mail merge can reuse them. Compose `onBeforeSend` hooks run in
feature order. A hook returns `"continue"`, `"handled"` (it took over the send) or
`"abort"`.

### Adding a provider (Outlook, Yahoo, …)

1. Implement `MailClientAdapter` from `src/providers/types.ts` in `src/providers/<name>/`.
   You need compose sessions with a before-send hook that can cancel and resume the
   send, `openCompose`, list rows and message views. If something isn't available,
   make it a no-op or return `undefined` (for example, `hasAttachments`).
2. Add an entry to `PROVIDERS` in `src/providers/registry.ts`. It is loaded with a
   dynamic import.
3. Add the provider's host to `host_permissions` and to `content_scripts.matches` in
   `scripts/manifest.mjs`.

No feature code needs to change.

## Testing

- Unit tests, from the repo root: `npx vitest run apps/extension`. They cover split
  planning, never-track domains, badge mapping, feed text, settings defaults, the
  status cache, dashboard grouping, and the mail merge queue (throttle scheduling, per-run
  cap, resume after reload, lease, failures) and campaign helpers.
- Type check: `pnpm --filter @bet/extension typecheck`.
- The popup, options and dashboard pages were smoke-tested in Chromium against a
  mocked Worker.
- The Gmail integration can only be tested by hand in a signed-in Gmail. Check:
  - the compose button
  - send interception
  - individual splitting
  - attachment detection
  - row badges
  - own-open pixel removal
  - mail merge sending from a Gmail tab (compose, confirm, throttle, resume after reload)
