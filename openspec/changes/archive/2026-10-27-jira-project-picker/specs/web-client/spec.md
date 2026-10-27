## MODIFIED Requirements

### Requirement: Jira import from the web client
The Jira Sync page SHALL let the board Admin of a connected board choose the Jira project from the list of projects of the connected site (shown as `name (KEY)`, the board's linked project preselected), run the import, and see its result (created, updated, skipped). When the project list cannot be loaded, the page SHALL fall back to entering the project key by hand. It SHALL show every member the status → column mapping, and let the Admin change and save it.

#### Scenario: Import
- **WHEN** the Admin of a connected board picks `Kanban (KAN)` and chooses Import
- **THEN** the import runs for `KAN`, the page shows the counts returned by the backend and the board shows the imported cards

#### Scenario: Linked project preselected
- **WHEN** the Admin opens the Jira Sync page of a board linked to `KAN`
- **THEN** the project picker shows `KAN` selected

#### Scenario: Project list unavailable
- **WHEN** listing the projects fails
- **THEN** the page offers a project key text field instead of the picker and the import still works with the typed key

#### Scenario: Edit the mapping
- **WHEN** the Admin picks another column for a status and saves
- **THEN** the mapping shows that status as stored (not default) after reload

#### Scenario: Not an Admin
- **WHEN** a Member opens the Jira Sync page
- **THEN** the mapping is shown read-only and no Import control is offered
