# Offer the prior reading language when sign-in changes the interface

## Context

The report saw a Chinese share turn into an English library for a test identity. The profile merge prioritizes the account language, and the current login response does not reliably distinguish a newly created account from a returning one.

## Goals / Non-Goals

When the account language differs from the Web language used to start sign-in, offer a one-time explicit choice to continue in the prior language or keep the account language.

## Decisions

Capture the originating interface language for the current sign-in attempt. Compare after account preference resolution. Present the choice in the originating language and use the existing preference writer only on affirmative selection. Avoid inferring account age or changing all returning readers' preferences.

## Risks / Trade-offs

Proposed Web-only remedy for the conditional finding, subject to product review. Sequence after fix-expired-session-cold-start for account-locale-sync.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
