# Shakomako versioning

The widget ships in two layers, so a site embeds one small script once and
still gets every new widget release without changing its embed code.

```
Website
  ↓  <script src=".../embed.js" data-agent-id="…">
embed.js           (unversioned, small, rarely changes)
  ↓  fetch version.json?t=<timestamp>
{VERSION}/widget.min.js   (versioned, cached forever)
```

## `embed.js` (the loader)

Location: `dist/embed.js`. Source: `src/embed.ts`. This is the only file a
site embeds.

On load it:

1. Finds its own `<script>` tag (`document.currentScript`, then
   `#chatbot-embed-script`, then the first `script[data-agent-id]` — Safari
   does not set `currentScript` for async scripts).
2. Reads the `data-*` attributes and stores them on `window.chatvia`.
3. Fetches `version.json?t=<timestamp>` from the script host. The timestamp
   stops any cache from serving an old version number.
4. Injects `{scriptHost}/{version}/widget.min.js`.

The script host is `VITE_SCRIPT_URL` when the build sets it, otherwise the
folder the `embed.js` file itself was loaded from. If the build value fails,
it retries once from that folder. A copy therefore works wherever `embed.js`,
`version.json` and the version folder sit next to each other.

A second `embed.js` on the same page does nothing (`window.chatvia.initialized`).

### Embed attributes

| Attribute | Required | Meaning |
|---|---|---|
| `data-agent-id` | yes | The agent's external id. |
| `data-mode` | no | `bubble` (default chat bubble) or `bar` (floating launcher bar). |
| `data-language` | no | UI language, or `auto` (default) to follow the browser. |
| `data-theme` | no | `auto`, `light` or `dark`. Absent: the agent's own setting. |
| `data-mount-id` | no | Render into this element instead of floating on the page. |
| `data-auth` | no | Signed bootstrap token (JWT) for a protected agent. |
| `data-api-url` | no | API base URL. Overrides `VITE_API_URL` and the default (`/widget` on the server `embed.js` loads from). |
| `data-reverb-host`, `data-reverb-port`, `data-reverb-key`, `data-reverb-scheme` | no | Live-chat (handoff) server. Override the `VITE_REVERB_*` build values and the values the server sends. |

`data-type="widget"` / `data-type="search"` are deprecated aliases of
`data-mode="bubble"` / `data-mode="bar"`; they still work and log a warning.

```html
<script
  src="https://cdn.example.com/embed.js"
  id="chatbot-embed-script"
  data-agent-id="YOUR_AGENT_ID"
  data-mode="bubble"
  async
></script>
```

## `{VERSION}/widget.min.js` (the widget)

Location: `dist/{VERSION}/widget.min.js`. Source: `src/main.ts`.

One bundle serves both modes; it reads `window.chatvia.mode` to render the
chat bubble or the floating bar. It is an IIFE (a classic script, not an ES
module) because `embed.js` injects it with a plain `<script>` tag. Its CSS is
inlined into the bundle.

## Build

`rollup.config.ts` produces:

```
dist/
├── embed.js           # loader, unversioned
├── version.json       # {"version": "<VERSION>"}
└── {VERSION}/
    └── widget.min.js  # the widget
```

Production builds also write `.gz` and `.br` copies next to each file, and
strip `console.log/debug/info` (`console.warn` and `console.error` stay).

```bash
npm run build       # production build (also: npm run build:prod)
npm run build:dev   # development build, plus bundle-analysis.html
```

### Environment

All optional, in `.env` (see the README for what happens without them):

| Variable | Meaning |
|---|---|
| `VITE_APP_VERSION` | Version folder name and the value written to `version.json`. Without it: the package version plus a hash of the sources and these settings, so every changed build gets a new folder. |
| `VITE_SCRIPT_URL` | Where `embed.js`, `version.json` and the version folders are served from. |
| `VITE_API_URL` | Default API base URL. |
| `VITE_REVERB_APP_KEY`, `VITE_REVERB_HOST`, `VITE_REVERB_PORT`, `VITE_REVERB_SCHEME` | Default live-chat server. |

## Releasing a new version

A Chatvia server builds the newest release of this repository into
`public/shakomako`: the highest `vX.Y.Z` tag. Pre-release tags
(`v3.1.0-beta.1`) and untagged commits are never built. Chatvia's
`npm run shakomako:build` and its Docker release workflow both find the
release by themselves; Chatvia does not store a version. The version folder
name changes by itself when the code changes. To ship a change to Chatvia:

1. When the change also needs a server change (the `/widget` API, its headers
   or settings), merge that change in Chatvia first. Every Chatvia build takes
   the newest release, so the server must be ready before the release exists.
2. `npm version X.Y.Z`. It sets the version in `package.json` and the
   lockfile, commits, and tags `vX.Y.Z`.
3. `git push --follow-tags`. The next Chatvia build takes the release.

For a copy on a CDN:

1. `npm run build`.
2. Upload the new `dist/{VERSION}/` folder, then overwrite `version.json` (and
   `embed.js` if it changed). Upload the folder first, so `version.json` never
   points at files that are not there yet.
3. Keep the old version folders. Pages that already loaded an old bundle keep
   using it.

### Caching

| File | Cache |
|---|---|
| `{VERSION}/*` | Long and immutable — a new release is a new URL. |
| `version.json` | `Cache-Control: no-cache`. The loader also adds a timestamp. |
| `embed.js` | Short. It rarely changes. |

### Rollback

Write the previous version into `version.json`. New page loads pick up the
old bundle straight away.

## Troubleshooting

- **The widget did not update.** Open `version.json` in a browser and check
  the number. If it is old, purge it from the CDN cache.
- **The bundle fails to load.** Check that `{VERSION}/widget.min.js` exists
  at the script host. The browser console shows the exact URL tried.
- **"Missing data-agent-id attribute."** The embed tag has no
  `data-agent-id`, or a page builder stripped the `data-*` attributes.
