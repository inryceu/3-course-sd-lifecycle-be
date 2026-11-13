# Jira sandbox, OAuth app and webhook tunnel

Everything a developer needs to run the Jira integration against a real Jira Cloud site (T-14). The integration tests do **not** need any of this: they use a stubbed Atlassian server.

## 1. Sandbox Jira Cloud site

1. Create a free Jira Cloud site (Jira Software, Free plan, up to 10 users): <https://www.atlassian.com/software/jira/free>. One site for the whole team, e.g. `boardsync-sandbox.atlassian.net`.
2. Invite the four team members as site users; the person who creates the OAuth app (section 2) needs to be a site admin.
3. Create a project, company-managed, Kanban template, key `SBX`.
4. Make the workflow statuses exactly **To Do / In Progress / In Review / Done** (Project settings → Workflows → add the *In Review* status between *In Progress* and *Done*, allow transitions from any status). These match the default BoardSync columns plus a review column.
5. Create 5–10 sample issues spread over the four statuses, at least one with a description and a comment.

## 2. OAuth 2.0 (3LO) app

1. Open <https://developer.atlassian.com/console/myapps/> → **Create** → **OAuth 2.0 integration**, name it `BoardSync (dev)`.
2. **Permissions** → Jira API → **Add**, then **Configure** and add the classic scopes:
   - `read:jira-work`, `write:jira-work`, `read:jira-user`
   - `manage:jira-webhook` (the backend registers, lists and refreshes dynamic webhooks)
   `offline_access` is not a console setting; the backend requests it in the authorise URL so Atlassian returns a refresh token.
3. **Authorization** → OAuth 2.0 (3LO) → callback URL. It must equal `JIRA_REDIRECT_URI` exactly:
   - local dev (`pnpm start:dev` + Vite): `http://localhost:5173/jira/callback`
   - full compose stack: `http://localhost:8080/jira/callback` (or `http://localhost:<WEB_PORT>/jira/callback`)

   If the console accepts only one callback URL, register the one you use and change it when you switch.
4. **Settings** → copy the **Client ID** and **Secret**.
5. **Distribution** stays **Not sharing** for now (see *Known limitation* below). While an app is *Not sharing* ("in development"), **only the Atlassian account that owns the app** can authorise it; everyone else gets *"You don't have access to this app. This application is in development - only the owner of this application may grant it access to their account."*, even site admins. Switching to Sharing (Distribution → Edit) asks for:
   - a vendor name: `BoardSync team`;
   - a privacy policy URL: the [Privacy](#privacy) section of this document;
   - a personal data declaration: **yes**. The app stores the issue content of the linked project (summary, description, status), which can contain personal data, and encrypted OAuth tokens. It does not store Atlassian account ids yet; update the declaration when assignee sync arrives.

**Team app (created 2026-10-21):** `BoardSync (dev)` in Pavlo's developer console, access type *Resource-level* (the user picks one site at consent), classic scopes `read:jira-work`, `write:jira-work`, `read:jira-user`, `manage:jira-webhook`, callback URLs `http://localhost:8090/jira/callback` (full stack with `WEB_PORT=8090`) and `http://localhost:5173/jira/callback` (`pnpm dev`). Distribution is **Not sharing**: only Pavlo's Atlassian account can approve the connect screen (see *Known limitation*). Ask Pavlo for the Client ID and Secret (section 3). Using another `WEB_PORT` means adding its callback URL in the console first.

The backend requests `JIRA_SCOPES` (default `read:jira-work,write:jira-work,read:jira-user,manage:jira-webhook,offline_access`). `manage:jira-webhook` is a valid classic 3LO scope. Every scope in `JIRA_SCOPES` must also be configured in the console, otherwise Atlassian rejects the authorise request. Connections created before the scope was added must be reconnected before webhook registration can succeed.

## 3. Credentials: share, never commit

- One person creates the app and shares Client ID and Secret through the team password manager (or a one-time secret link such as Bitwarden Send). Never paste them into chat, Jira or Git.
- Each developer puts them into the git-ignored files:
  - `.env.local` for `pnpm start:dev`
  - `.env.full` for `docker-compose.full.yml`

  ```dotenv
  JIRA_CLIENT_ID=<client id>
  JIRA_CLIENT_SECRET=<secret>
  JIRA_REDIRECT_URI=http://localhost:5173/jira/callback
  ```
- `TOKEN_ENCRYPTION_KEY` is per developer (`openssl rand -hex 32`); tokens encrypted with one key cannot be read with another, so changing it means connecting Jira again.
- If a secret leaks, regenerate it in the console (Settings → **Rotate secret**) and share the new one.

## 4. Check the connect flow

1. Start the backend and the frontend, register and create a board.
2. As the board Admin call `GET /api/v1/jira/oauth/start?boardId=<board id>` (Swagger UI) and open the returned `authorizeUrl`.
3. Or simply use the web client: **Jira Sync** → **Connect Jira** on the board.
4. Accept the consent screen for the sandbox site. Atlassian redirects to the frontend page `/jira/callback?code=…&state=…`, which completes the flow and shows the connected site.
5. `GET /api/v1/jira/connection?boardId=<board id>` (or the Jira Sync page) shows `connected: true` and the sandbox site URL.

### Troubleshooting

| Atlassian says | Cause | Fix |
| --- | --- | --- |
| `invalid_request` / `failed to retrieve client` | `JIRA_CLIENT_ID` is still the placeholder or belongs to a deleted app | put the real Client ID and Secret into `.env.full` / `.env.local`, then `docker compose --env-file .env.full -f docker-compose.full.yml up -d backend` |
| `redirect_uri` mismatch | `JIRA_REDIRECT_URI` (full stack: `http://localhost:<WEB_PORT>/jira/callback`) is not in the app's callback URLs | add it under **Authorization** in the console |
| `invalid_scope` | a scope in `JIRA_SCOPES` is not configured in the console | add it under **Permissions** → Jira API |

## 5. Webhooks to a laptop through a tunnel

Jira Cloud cannot call `localhost`, so a public HTTPS tunnel forwards its webhooks to the backend.

1. Start a tunnel to the backend port (no account needed):

   ```bash
   cloudflared tunnel --url http://localhost:3000
   # or: ngrok http 3000
   ```

   It prints a URL such as `https://random-words.trycloudflare.com`. A quick tunnel gets a new URL on every start.
2. Point the backend at it and restart:

   ```bash
   JIRA_WEBHOOK_URL=https://<tunnel>/api/v1/jira/webhook
   ```

   After a board is connected and its project key is imported, the backend registers a dynamic webhook through Jira's REST API. Reconnect boards whose connection predates `manage:jira-webhook`, and re-run the import after the tunnel URL changes.
3. Move an issue in Jira. The receiver reads `issue.fields.status`, applies the stored status mapping or its status category, and moves the linked card. Watch the tunnel output (`cloudflared` logs every request) or the backend log.

### Delivery authentication

- Deliveries for a dynamic webhook registered by an OAuth 2.0 app carry `Authorization: Bearer <JWT>`, signed with the app's client secret; the receiver verifies it against `JIRA_CLIENT_SECRET`, issuer `JIRA_CLIENT_ID`, and `exp`.
- `X-Hub-Signature: sha256=<hex>` carries HMAC-SHA256 of the exact raw request body using `WEBHOOK_SECRET`. If the header is present it takes precedence; an invalid HMAC is rejected and never retried as a JWT.
- The old `?secret=` query parameter is not supported. Requests without either proof get `401`; the endpoint is public only in the sense that it is exempt from the app's bearer guard.

### Webhook lifetime

Dynamic webhooks expire 30 days after creation or the last refresh. Every six hours the backend refreshes rows expiring within seven days. Expired rows can be refreshed for up to three months, after which the backend registers a replacement. Set `JIRA_WEBHOOK_URL` to a stable HTTPS host outside local debugging; with a quick tunnel and no restart, the registered URL eventually goes stale.

## Checklist (T-14)

- [ ] Sandbox site and project `SBX` with To Do / In Progress / In Review / Done and sample issues
- [x] OAuth 2.0 (3LO) app with the scopes above and the local callback URL(s)
- [ ] Client ID and Secret shared through the password manager, present in everyone's `.env.local`
- [ ] App distribution set to Sharing (blocked, see *Known limitation*)
- [ ] Connect flow (section 4) succeeds against the sandbox
- [ ] A webhook reaches a laptop through the tunnel (section 5), either by backend registration or by a signed manual `curl`

## Known limitation: only the app owner can connect Jira

Decided 2026-10-25. "BoardSync (dev)" stays **Not sharing**, so the Atlassian consent screen accepts **only the app owner's account (Pavlo)**. Anyone else gets *"This application is in development - only the owner of this application may grant it access"*.

Why: Atlassian allows Sharing only with a personal data declaration. Because BoardSync keeps imported issue content longer than 24 hours, the honest answer is "Yes", and "Yes" requires the **Personal Data Reporting API** (Atlassian polls the app about stored account data and the app must erase closed accounts). BoardSync does not implement it yet.

How the team works meanwhile:
- To connect a board to Jira, add Pavlo to the board as **Admin** (Members panel), and Pavlo presses **Connect Jira** on the Jira Sync page. The connection then belongs to the board, so every member uses the import and, later, sync.
- The stored tokens act as Pavlo's Jira account, so imported changes and future write-backs (T-25) appear in Jira under his name.

To lift it, implement the Personal Data Reporting API (backlog ticket), then switch Distribution to Sharing with the answers listed in section 2.

## Privacy

BoardSync stores, per connected board: the Atlassian cloud id and site URL, the OAuth access and refresh tokens (AES-256-GCM encrypted, never logged or returned by the API), the granted scopes, and for imported issues their key, id, summary, description and status mapping. Atlassian account ids are not stored yet. Disconnecting a board deletes its tokens; deleting a board deletes its cards. Questions: the team via the repository's issue tracker.
