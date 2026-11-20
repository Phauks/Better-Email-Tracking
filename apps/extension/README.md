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
| `nudges`             | see text | Follow-up defaults: schedule (3 days, then every 4, up to 3), text, stop on open, working hours.     |

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
- **Follow up if no reply.** The alarm button in the compose toolbar opens a popover:
  Off, Default (from options) or Custom (first after N days, then every M days, up to
  K nudges, with editable text and `{{firstName|there}}`-style placeholders). After the
  email is sent, the extension asks the Worker to create a sequence for it. With
  "Track each recipient", every copy gets its own sequence and its own personalised
  nudges. The Worker sends the nudges from your Gmail as replies in the thread and
  stops when someone answers, so your computer can be off. Connect Gmail once under
  **Options → Follow-ups** (the Worker needs Google OAuth set up; see
  `apps/worker/README.md`). If it isn't connected, the popover and a notice after
  sending say so. Nudges go to the original's visible To/CC, never BCC. Follow-ups
  need tracking on for that email, and only work for mail sent from the connected
  Gmail account.
- **Popup and dashboard.** The popup shows recent activity. The dashboard is a
  full tab with search, a status filter, individual sends grouped per recipient,
  and an event timeline that labels each event's source (Gmail proxy, Apple
  privacy proxy, scanner, direct) and device. Its **Follow-ups** tab lists every
  sequence with its state, next send time and history, with pause, resume and
  cancel. Sent nudges and replies also appear in the popup, notifications and
  timelines; a row badge's tooltip says "Replied" once someone answers.

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
    compose-tracking/  individual-send/  own-open/  sent-status/  follow-up/
    sent-events.ts  hub: tracked sends (with thread ids) for features like follow-up
  content/          content-script entry; builds the FeatureContext
  background/       service worker: API proxy, feed polling, notifications, badge
  messaging.ts      typed content -> background message union
  api/client.ts     typed Worker client (background and extension pages)
  settings.ts       typed chrome.storage.sync settings with defaults
  lib/              pure, unit-tested logic (status badges, feed text, grouping, domains)
  ui/               Svelte 5 pages (popup, options, dashboard), icons.ts, Icon.svelte
```

Content scripts never call the Worker directly. They send typed messages
(`src/messaging.ts`) to the background, which holds the token and the host permission.

### Adding a feature

Create `src/features/<name>/index.ts` that exports a `Feature` (`{ id, setup(ctx) }`),
then add it to the list in `src/features/index.ts`. `ctx` gives you the adapter, the
API, current settings and the tracking URL builders. Shared send helpers, such as
instrumenting HTML and building the register request, are in `src/features/tracking.ts`,
so later modules like mail merge can reuse them. Features that need to act after a
tracked message is sent (with its provider thread id) subscribe with `onTrackedSent`
from `src/features/sent-events.ts`; senders call `emitTrackedSent`. A toolbar control can
ask for an anchored popover (`popover: true`) and mount a Svelte component into it, as
`follow-up/` does; content-script Svelte components inject their own CSS. Compose `onBeforeSend` hooks run in
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
  status cache, dashboard grouping, follow-up policies and template rendering.
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
  - the follow-up popover, scheduling after a send (shared and individual), and
    the Options → Follow-ups Gmail connection
