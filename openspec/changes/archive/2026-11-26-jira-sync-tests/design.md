## Context

The branch first shipped a `JiraRetryService` around the gateway, a `JiraTokenRefreshService`, a retry
endpoint for sync logs and a time-based `requiresReconnect`. KAN-46 now owns outbound resilience
(durable outbox, backoff with jitter and `Retry-After`, dead letter, Admin requeue), and the gateway
already refreshes tokens with compare-and-set and clears the refresh token on `invalid_grant`.

## Decisions

1. **Drop the wrapper and the refresh service.** A POST that Jira may have applied must not be
   re-sent: the gateway throws instead of retrying a sent POST, and `jira-comment-sync` promises at
   most one attempt per comment. A second retry layer also multiplies the gateway's own attempts.
2. **Drop the retry endpoint.** A sync log row does not carry the comment text, so a "retry" could
   only post an empty comment, and a stale status move could overwrite a newer column. Status retries
   already exist as the outbox requeue.
3. **`requiresReconnect = refreshTokenEnc IS NULL AND expiresAt <= now`.** It reads the same state the
   gateway acts on. `refresh_token_enc` is `select: false`, so `getStatus` selects it explicitly and
   exposes only the boolean.
4. **Keep the list endpoint.** It is read-only and Admin only (403 for members and non-members, like
   the other Admin operations of the module), keyset-paged on `(createdAt, id)` with a `limit + 1`
   fetch. Its documented errors are 400 (validation), 401, 403 and 404; there is no 409 because
   nothing in it is a state conflict.
