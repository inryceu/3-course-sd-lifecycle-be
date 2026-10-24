## ADDED Requirements

### Requirement: Jira import from the web client
The Jira Sync page SHALL let the board Admin of a connected board enter or confirm the Jira project key, run the import, and see its result (created, updated, skipped). It SHALL show every member the status → column mapping, and let the Admin change and save it.

#### Scenario: Import
- **WHEN** the Admin of a connected board enters `KAN` and chooses Import
- **THEN** the page shows the counts returned by the backend and the board shows the imported cards

#### Scenario: Edit the mapping
- **WHEN** the Admin picks another column for a status and saves
- **THEN** the mapping shows that status as stored (not default) after reload

#### Scenario: Not an Admin
- **WHEN** a Member opens the Jira Sync page
- **THEN** the mapping is shown read-only and no Import control is offered
