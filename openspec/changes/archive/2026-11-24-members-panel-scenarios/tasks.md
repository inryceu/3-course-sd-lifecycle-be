# Tasks

## 1. Spec review

- [x] 1.1 Confirm the `Members panel` MODIFIED block in `specs/web-client/spec.md` keeps the `Invite` and `Last Admin` scenarios unchanged and adds the six requested scenarios; verify the file has eight `#### Scenario:` headers and the requirement description matches `openspec/specs/web-client/spec.md` verbatim
- [x] 1.2 Check each new scenario against `3-course-sd-lifecycle-fe/src/features/boards/MembersPanel.tsx` and `openspec/specs/board-members/spec.md`; verify no scenario names an endpoint, role or behavior those sources do not support
- [x] 1.3 Run `openspec validate "members-panel-scenarios" --strict`; verify zero errors and zero warnings

## Workflow follow-up

- Archive the change after review; archive applies the delta to `openspec/specs/web-client/spec.md`.
- Verify the archived main spec's `Members panel` requirement contains all nine scenarios and no other changes.
