# Snapshot source cleanup

## ADDED Requirements

### Requirement: Remove CAC utility frames from article captures

When capturing an article on www.cac.gov.cn, the parser SHALL discard same-origin iframes whose resolved path is /cms/pub/interact/jiucuo.htm or /inc/date/My97DatePicker.htm and preserve the article body.

#### Scenario: A snapshot contains correction and date-picker tools

- **WHEN** the article includes either tool with a relative or absolute same-origin URL
- **THEN** the saved article omits those frames and retains its authored paragraphs

#### Scenario: A different embed shares a filename or host

- **WHEN** an iframe has another origin or path, or the captured page belongs to another host
- **THEN** this filter leaves it available to the article parser

### Requirement: Save authored content from FxTwitter article previews

For the reported author-headed FxTwitter preview, the API SHALL store the article title when available and the authored body with its formatting and media. It SHALL exclude the provider's thread navigation, engagement summary and closing author profile from the snapshot.

#### Scenario: The provider preview wraps a complete article

- **WHEN** the recognized preview supplies a cover with the article title and a usable body
- **THEN** the bookmark uses that title and saves the authored content directly from the embed, including any author-written About author section

#### Scenario: The preview lacks a title or body

- **WHEN** the recognized preview lacks a title or authored body
- **THEN** capture can use the existing structured provider with a known status ID, retaining an available authored body when a title cannot be recovered and following the existing fallback when the body is missing
