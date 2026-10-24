## ADDED Requirements

### Requirement: Manage board members
The board Admin SHALL be able to invite an already registered user by e-mail as `MEMBER` or `VIEWER`, change a member's role (including to `ADMIN`) and remove a member; every member SHALL be able to list the members. Responses SHALL follow the `Member` schema of the API contract.

#### Scenario: Invite
- **WHEN** the Admin invites `bob@example.com` (any letter case) as `MEMBER`
- **THEN** the response is 201 with the new `Member`, including `boardId`

#### Scenario: Invite as Admin is not allowed
- **WHEN** the invite asks for role `ADMIN`
- **THEN** the response is 400

#### Scenario: Unknown e-mail
- **WHEN** no registered user has the e-mail
- **THEN** the response is 400

#### Scenario: Duplicate invite, also when concurrent
- **WHEN** the user is already a member, or two identical invites arrive at the same time
- **THEN** one invite succeeds and the other answers 409

#### Scenario: Change role
- **WHEN** the Admin changes a member's role
- **THEN** the response is 200 with the updated `Member`

### Requirement: A board always keeps an Admin
Demoting or removing an Admin SHALL fail with 409 when it would leave the board without an Admin, also when several such requests arrive at the same time.

#### Scenario: Sole Admin
- **WHEN** the only Admin demotes or removes themselves
- **THEN** the response is 409 and nothing changes

#### Scenario: Two Admins demote each other concurrently
- **WHEN** Admins X and Y send demotions of each other at the same time
- **THEN** one succeeds, the other answers 409, and the board keeps one Admin

### Requirement: Role-based access to members
Only the Admin SHALL change membership; any member SHALL read it; a user who is not a member SHALL get 404 so the board's existence is not revealed.

#### Scenario: Member tries to invite
- **WHEN** a `MEMBER` or `VIEWER` invites someone
- **THEN** the response is 403

#### Scenario: Stranger lists
- **WHEN** a user who is not a member lists the members
- **THEN** the response is 404
