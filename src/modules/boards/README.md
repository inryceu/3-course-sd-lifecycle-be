# Boards Module

This module manages the core domain of BoardSync: kanban boards, columns, cards, and board memberships.

## Role Matrix

Board access is governed by the `BoardAccessGuard` and enforced via the `@BoardRoles()` decorator based on the following matrix:

| Action                          | Admin | Member | Viewer    |
| ------------------------------- | ----- | ------ | --------- |
| List members                    | ✅    | ✅     | ✅        |
| Invite / change / remove member | ✅    | ❌     | ❌        |
| Create / move / edit cards      | ✅    | ✅     | ❌        |
| Read cards / comments           | ✅    | ✅     | read-only |
| Board settings / manage columns | ✅    | ❌     | ❌        |
