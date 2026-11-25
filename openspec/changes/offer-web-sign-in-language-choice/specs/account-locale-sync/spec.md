## ADDED Requirements

### Requirement: Offer the prior reading language when sign-in changes the interface

The Web experience SHALL when the account language differs from the Web language used to start sign-in, offer a one-time explicit choice to continue in the prior language or keep the account language.

#### Scenario: Different languages

- **WHEN** a reader starts sign-in in Chinese and returns with an English account preference
- **THEN** the reader receives a Chinese-language choice that can select Chinese or retain English

#### Scenario: Existing preference

- **WHEN** the reader keeps English or dismisses the offer and refreshes
- **THEN** English remains selected and the same completed sign-in does not prompt again

#### Scenario: Matching language

- **WHEN** the account language already matches the originating Web language
- **THEN** sign-in continues without an extra language prompt
