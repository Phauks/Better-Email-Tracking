# Better Email Tracking

Self-hosted open and click tracking for Gmail, built for one person. No "Sent with…" signature, no feature gates, and your recipients' data stays on your own Cloudflare account.

## What it does

- **Opens and clicks**: a 1x1 pixel and per-link redirects, served from your own subdomain.
- **Track each recipient**: optionally sends each recipient their own copy so you see exactly who opened (recipients no longer see each other; CC/BCC become separate emails).
- **Ignores your own opens**: send-time grace window, "owner is viewing" signal from the extension, and your IP for direct loads.
- **Honest opens**: Gmail image proxy, Apple Mail Privacy Protection (machine) and security scanners are labelled separately.
- **Sent-list status icons**, desktop notifications, a popup activity feed and a full dashboard tab.
- **Follow-ups until reply**: the Worker replies in the same thread from your Gmail on a schedule you pick (for example after 3 days, then every 4 days, up to 3 times) and stops as soon as anyone answers. It runs on Cloudflare, so your computer can be off. Each nudge has its own pixel. Needs a one-time Google OAuth setup (see `apps/worker/README.md`).

## Layout

| Path              | What                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `packages/shared` | Provider-neutral HTTP contract, URL builders, HTML instrumentation, request classification          |
| `apps/worker`     | Cloudflare Worker (Hono + D1): pixel, click redirect, API, retention cron. See its README to deploy |
| `apps/extension`  | Chrome MV3 extension (Svelte 5, Vite, InboxSDK for Gmail). See its README to load it                |

Both apps are modular: Worker features register in `apps/worker/src/modules.ts`, extension features in `apps/extension/src/features/index.ts`, and mail clients behind `MailClientAdapter` in `apps/extension/src/providers/` (Gmail today; Outlook or Yahoo can be added as new adapters). Server-side mailbox access (used by follow-ups) sits behind `MailboxConnector` in `apps/worker/src/connectors/` (Gmail API today; Microsoft Graph or IMAP/SMTP can be added the same way).

## Develop

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck
pnpm lint        # biome
pnpm build
```

Icons: [Phosphor](https://phosphoricons.com/) (MIT) via `@phosphor-icons/core`.

## Privacy

Tracking collects when, and roughly how, your recipients read your mail. Raw IPs are never stored (salted hash only), location is off by default, and data is purged after `RETENTION_DAYS` (180 by default). Check the rules where your recipients live (for example UK PECR / EU ePrivacy) before tracking them.

## Roadmap

Document and attachment tracking with page views, and bulk mail merge with per-recipient tracking.
