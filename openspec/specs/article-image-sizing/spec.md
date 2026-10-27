# article-image-sizing Specification

## Purpose
Keep WeChat article images proportional within the reader while retaining intentional sizes and other source formatting.

## Requirements

### Requirement: Oversized fixed-dimension WeChat images adapt to the reader

For articles whose host is `mp.weixin.qq.com`, outside PhotoSwipe presentation, the Web reader SHALL make images with inline pixel width and height responsive when their declared width exceeds the measurable article width. It SHALL replace the fixed dimensions with full available width and automatic height, overriding inline `!important` dimensions while preserving unrelated formatting. This correction SHALL run without waiting for image loading or requiring article recapture.

#### Scenario: Oversized lazy image

- **WHEN** an existing saved WeChat article contains a lazy image with inline dimensions of 2490px by 1148px in a 772px-wide article container
- **THEN** the reader removes the excessive fixed height before the load event and uses responsive width and automatic height
- **AND** margins and rounded corners are preserved
- **AND** the loaded image displays at its intrinsic aspect ratio

#### Scenario: Intentional sizes remain unchanged

- **WHEN** an image's fixed dimensions fit the article width, including a 24px icon backed by a high-resolution source
- **THEN** the responsive-sizing correction preserves those dimensions
- **AND** images already using percentage width or automatic height are left unchanged by this correction

#### Scenario: Other article presentations remain unchanged

- **WHEN** an image belongs to a non-WeChat article or PhotoSwipe presentation
- **THEN** this correction does not alter its dimensions and existing image behavior remains in effect

### Requirement: Image sizing follows article width changes

Where resize observation is supported, the reader SHALL recheck eligible images when the article width changes and make newly oversized images responsive. It SHALL wait for a positive width before changing dimensions and release resize observation when the article is disposed. Without resize observation, the initial sizing correction SHALL still work.

#### Scenario: Reader becomes narrower

- **WHEN** a 600px by 300px image initially fits a 772px article and the article narrows to 360px
- **THEN** the image switches to responsive width and automatic height

#### Scenario: Article initially has no measurable width

- **WHEN** the article initially measures zero width and later gains a positive width with resize observation available
- **THEN** no correction is applied at zero width and oversized images are corrected when the positive width is observed

#### Scenario: Article disposal

- **WHEN** the article is disposed
- **THEN** its image-sizing observer is disconnected

#### Scenario: Resize observation is unavailable

- **WHEN** a measurable article contains an oversized eligible image in an environment without resize observation
- **THEN** the initial correction runs without an error
