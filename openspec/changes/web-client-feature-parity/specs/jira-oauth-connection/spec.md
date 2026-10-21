## ADDED Requirements

### Requirement: Frontend callback page
The web client SHALL serve the registered redirect route `/jira/callback`, pass the received `code`, `state` and `error` to `GET /jira/oauth/callback` with the user's token, and show the outcome.

#### Scenario: Successful return from Atlassian
- **WHEN** Atlassian redirects the Admin to `/jira/callback?code=...&state=...`
- **THEN** the page completes the flow and shows the connected Jira site with a link back to the Jira page

#### Scenario: Denied or failed
- **WHEN** the redirect carries `error=access_denied` or the backend answers 400
- **THEN** the page shows that the connection failed and offers to try again
