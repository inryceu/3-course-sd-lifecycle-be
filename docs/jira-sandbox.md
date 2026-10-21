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
   - `manage:jira-webhook` (needed once the backend registers webhooks itself, T-26)
   `offline_access` is not a console setting; the backend requests it in the authorise URL so Atlassian returns a refresh token.
3. **Authorization** → OAuth 2.0 (3LO) → callback URL. It must equal `JIRA_REDIRECT_URI` exactly:
   - local dev (`pnpm start:dev` + Vite): `http://localhost:5173/jira/callback`
   - full compose stack: `http://localhost:8080/jira/callback` (or `http://localhost:<WEB_PORT>/jira/callback`)

   If the console accepts only one callback URL, register the one you use and change it when you switch.
4. **Settings** → copy the **Client ID** and **Secret**.
5. **Distribution** can stay *Not sharing*: an app that is not distributed can still be authorised by members of the sites its owner administers.

**Team app (created 2026-10-21):** `BoardSync (dev)` in Pavlo's developer console, access type *Resource-level* (the user picks one site at consent), classic scopes `read:jira-work`, `write:jira-work`, `read:jira-user`, `manage:jira-webhook`, callback URLs `http://localhost:8090/jira/callback` (full stack with `WEB_PORT=8090`) and `http://localhost:5173/jira/callback` (`pnpm dev`). Ask Pavlo for the Client ID and Secret (section 3). Using another `WEB_PORT` means adding its callback URL in the console first.

The backend requests `JIRA_SCOPES` (default `read:jira-work,write:jira-work,read:jira-user,offline_access`). Add `manage:jira-webhook` to `JIRA_SCOPES` when T-26 starts registering webhooks; it is a valid classic 3LO scope (the archived `jira-connection` design note that called it invalid is wrong). Every scope in `JIRA_SCOPES` must also be configured in the console, otherwise Atlassian rejects the authorise request.

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
2. Register the webhook in the sandbox: Jira settings (cog) → **System** → **WebHooks** → **Create a WebHook**
   - URL: `https://<tunnel>/api/v1/jira/webhook?secret=<WEBHOOK_SECRET>` (the receiver checks the secret; the endpoint is built in T-26, until then you will see `404` in the tunnel log, which already proves delivery works)
   - Events: *Issue created, updated, deleted* and *Comment created*
   - JQL filter: `project = SBX`
3. Move an issue in Jira and watch the tunnel output (`cloudflared` logs every request) or the backend log.

Later (T-26) the backend registers its own webhook through the REST API with the `manage:jira-webhook` scope, so step 2 becomes a fallback for local debugging.

## Checklist (T-14)

- [ ] Sandbox site and project `SBX` with To Do / In Progress / In Review / Done and sample issues
- [x] OAuth 2.0 (3LO) app with the scopes above and the local callback URL(s)
- [ ] Client ID and Secret shared through the password manager, present in everyone's `.env.local`
- [ ] Connect flow (section 4) succeeds against the sandbox
- [ ] A webhook reaches a laptop through the tunnel (section 5)
