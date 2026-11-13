## ADDED Requirements

### Requirement: Notifications operations
`docs/api/openapi.yaml` SHALL describe `GET /notifications` returning `NotificationPage` and `POST /notifications/{notificationId}/read` returning `Notification` (404 for an unknown or another user's notification), and these operations SHALL no longer be marked with `x-implemented-in`.

#### Scenario: Contract matches the implementation
- **WHEN** a reader opens the notifications operations
- **THEN** they carry no `x-implemented-in` and document 200, 401 and (for mark read) 404
