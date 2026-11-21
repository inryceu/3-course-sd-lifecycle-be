## MODIFIED Requirements

### Requirement: Scheduler interval
The scheduler SHALL run every `REMINDER_INTERVAL_SECONDS` seconds (default 60) while the application runs, SHALL be disabled when the value is `0`, SHALL not start a run while the previous one is still in progress, SHALL survive a failed run, and SHALL stop when the application shuts down.

#### Scenario: Interval elapses
- **WHEN** the configured interval elapses
- **THEN** one reminder run is started

#### Scenario: Disabled
- **WHEN** `REMINDER_INTERVAL_SECONDS` is `0`
- **THEN** no timer is started

#### Scenario: Previous run still in progress
- **WHEN** the interval elapses while the previous run has not finished
- **THEN** no second run is started, and the next tick after it finishes starts one

#### Scenario: Failed run
- **WHEN** a run fails with an error
- **THEN** the error is logged and the next interval starts a new run

#### Scenario: Shutdown
- **WHEN** the application shuts down
- **THEN** the timer is cleared and no further run starts
