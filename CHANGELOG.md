# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- **Debt payments no longer revert after a refresh.** Recording a repayment
  (on "Who owes me" / "I owe them" / credit sales) during a network blip could
  silently fail, show a false "Payment recorded", then disappear on the next
  refresh. Three issues were behind it: write failures were swallowed, the
  offline sync queue was never wired up, and the refresh merge dropped optimistic
  edits to already-synced debts. Failed writes are now queued and retried on
  reconnect, the queue is flushed before each refresh, and any still-pending
  payment is re-applied so it survives until it lands server-side.

### Added

- Regression tests for the offline debt merge/reconciliation path
  (`mergeDebts`), covering the payment-revert scenario, post-sync de-duplication,
  and ordering.
