# Spec Delta

## MODIFIED Requirements

### Requirement: Model thinking cannot consume the article allowance

All YouTube and podcast article text generation SHALL use `deepseek-flash` with thinking disabled and bounded output. Truncated replies SHALL remain incomplete and recoverable. The provider SHALL use the fixed API base `https://api.deepseek.com` and configured key, without a legacy provider fallback.

#### Scenario: Long chunk completes
- **WHEN** an article workflow requests editing, translation, headings or an introduction
- **THEN** it uses the fixed DeepSeek endpoint, `deepseek-flash`, non-thinking JSON output and an explicit output limit

#### Scenario: Provider truncation
- **WHEN** the provider reports an output-length limit
- **THEN** partial JSON is not accepted as a complete article and recovery respects the remaining budget

#### Scenario: Key is missing
- **WHEN** DeepSeek credentials are absent
- **THEN** no alternate model is called and the generation failure does not expose credentials or request content

#### Scenario: YouTube chunk uses the thinking level
- **WHEN** a YouTube article chunk call is made
- **THEN** it carries no Gemini thinking settings under the DeepSeek provider contract, and a `MAX_TOKENS` reply is handled by the established truncation recovery

### Requirement: Numeric tokens survive translation

Podcast translation prompts SHALL list the chunk's numeric tokens and the system instruction SHALL require every number, date, unit and quantity to be written as digits, never as a word or a Chinese numeral.

#### Scenario: Numbers in a translated article

- **WHEN** the caption contains `10,000`, `100 million`, `24-7` or `2,600`
- **THEN** the chunk prompt lists those tokens and the article keeps them as digits, so podcast number coverage checks can compare them

YouTube translation prompts SHALL request faithful numbers and quantities. Numeric differences SHALL remain diagnostics rather than proof that a source passage was omitted.

#### Scenario: YouTube numeric variation
- **WHEN** a structurally complete YouTube translation uses an equivalent quantity or resolves ambiguous source speech differently
- **THEN** numeric diagnostics do not block publication

