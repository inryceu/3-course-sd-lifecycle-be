## Purpose

Defines how backend feature modules are laid out and how they may depend on each other, so four developers can build modules in parallel without the modular monolith decaying into a ball of mud.

## ADDED Requirements

### Requirement: Standard module layout
Every backend feature module SHALL be organised into `domain`, `application`, `infrastructure` and `presentation` folders plus an `index.ts` public API and a Nest module file, and the layout SHALL be documented in `docs/architecture/module-structure.md`.

#### Scenario: Reference module follows the layout
- **WHEN** a developer opens the `health` module
- **THEN** it contains a domain type, an application service with a port, an infrastructure adapter, a presentation controller and an `index.ts`

#### Scenario: Layout is documented
- **WHEN** a developer reads `docs/architecture/module-structure.md`
- **THEN** it describes each folder, the public-API rule, the allowed dependency direction and a one-line SOLID checklist

### Requirement: Public API only through index
A module SHALL expose to other modules only what its `index.ts` exports, and other modules SHALL NOT import any deeper path of it.

#### Scenario: Deep import is rejected
- **WHEN** a file in module `boards` imports a path below `@modules/auth` other than its index
- **THEN** lint reports an error and CI fails

#### Scenario: Index import is accepted
- **WHEN** a file in module `boards` imports `AUTH_FACADE` from `@modules/auth`
- **THEN** lint reports no boundary error

### Requirement: No cross-module entity or repository access
A module SHALL NOT import entities or repositories of another module, and SHALL collaborate with other modules only through exported ports (injection tokens such as `AUTH_FACADE` and `BOARDS_FACADE`) or published events.

#### Scenario: Entity import is rejected
- **WHEN** a file in module `jira-sync` imports a `boards` entity
- **THEN** lint reports an error and CI fails

#### Scenario: Collaboration through a port
- **WHEN** `jira-sync` needs a user's role on a board
- **THEN** it injects `BOARDS_FACADE` and calls the port instead of querying board tables

### Requirement: Acyclic dependency direction
Module dependencies SHALL be limited to `boards → auth`, `jira-sync → auth`, `jira-sync → boards`, and `realtime` depending only on the shared event bus, shared ports and `AUTH_FACADE`; `auth` SHALL NOT depend on any other module and `forwardRef()` SHALL NOT be used.

#### Scenario: Forbidden dependency
- **WHEN** a file in module `auth` imports `@modules/boards`
- **THEN** lint reports an error and CI fails

#### Scenario: forwardRef is rejected
- **WHEN** a file calls `forwardRef()`
- **THEN** lint reports an error

### Requirement: Boundary rules are tested
The boundary rules SHALL be verified by an automated test that lints sample files against the real ESLint configuration.

#### Scenario: Test fails when a rule is loosened
- **WHEN** a boundary pattern is removed from the ESLint configuration
- **THEN** the boundary test fails

### Requirement: Lint gate does not rewrite code
The `lint` script used by CI SHALL report problems without modifying files.

#### Scenario: CI lint on a violation
- **WHEN** a file violates a lint rule and CI runs `pnpm lint`
- **THEN** the job fails and the file is left unchanged
