# Spec Delta

## Purpose

Deliver Mobile Reader article images and background article content with enough parallelism and a visible, recoverable failure state, on a network client that falls back between address families.

## ADDED Requirements

### Requirement: Image downloads start on aliased platform storage

The Android image registry SHALL accept the platform cache directory when the platform reports it through an alias of its real location, such as the `/data/user/0` user mount for `/data/data`. It SHALL still reject a staging directory, or any path below it, that is a symbolic link or resolves elsewhere.

#### Scenario: The platform cache directory is a user-mount alias
- **WHEN** the app's cache directory is reported as `/data/user/0/<package>/cache` and resolves to `/data/data/<package>/cache`
- **THEN** Reader and background image downloads start and complete

#### Scenario: The staging directory is a link
- **WHEN** `slax-image-transfers` under the cache directory is a symbolic link to another location
- **THEN** the registry refuses to start and no image is written there

### Requirement: Background acquisition downloads with bounded parallelism

Automatic offline acquisition on Android and iOS SHALL limit parallel work as follows:

- Each cache domain (personal or collection) SHALL run at most seven concurrent article-content requests.
- Background acquisition SHALL run at most seven concurrent image downloads across all articles.
- One article's eligible images SHALL be downloaded in parallel within that limit, not one at a time.

Image results SHALL still be committed to the article's manifest in batches. Cancellation, account revocation, the image-download preference, error-specific retries, and atomic file commits SHALL keep their existing behavior.

#### Scenario: An image-rich article is cached in the background
- **WHEN** an article with twenty eligible images is cached while online with image downloading enabled
- **THEN** up to seven of its images download at the same time, and its manifest records every image's outcome

#### Scenario: Image downloading is turned off during acquisition
- **WHEN** the image-download preference is disabled while background images are downloading
- **THEN** the running image downloads are cancelled and no new background image download starts

### Requirement: The Reader keeps image capacity that background work cannot take

The shared native image registry SHALL admit at most ten concurrent downloads, with at most ten per host. Background acquisition SHALL use at most seven, so at least three registry slots remain available to an open Reader. The registry's staging budget SHALL bound each image's size, not the number of concurrent downloads. Identical image requests SHALL keep being deduplicated into one download.

#### Scenario: The Reader opens while the background cache is busy
- **WHEN** background acquisition is downloading seven images and the user opens an article whose images are not cached
- **THEN** the Reader's images start downloading without waiting for background images to finish

### Requirement: A failed Reader image shows a placeholder that can be retried

When an article image fails to load in the HTML Reader, the image element SHALL remain in the document in its original position, and SHALL be shown as a placeholder. The placeholder SHALL have:

- a fixed light-gray background
- a centered broken-image icon
- the text `点击重试` when the document's locale is Chinese, and `Tap to retry` otherwise
- the accessibility label of that text and a button role

Tapping the placeholder SHALL reload that image once through the same native transport. While it reloads, the placeholder SHALL show a loading state and SHALL ignore further taps. When the reload succeeds, the image SHALL be shown with the size handling and gallery tap a first-time success would have. When it fails, the placeholder SHALL return and can be tapped again. The placeholder and retry SHALL NOT add, remove, or reorder document nodes, and existing highlights on the image SHALL still resolve. A long press on a placeholder SHALL NOT open image actions. A tap on a placeholder SHALL NOT open the gallery or toggle the toolbar. Images smaller than five pixels, images without a source, and images hidden by the article's own markup SHALL keep their existing hidden behavior.

#### Scenario: An image fails on first load
- **WHEN** a Reader image request fails
- **THEN** the image is replaced in place by the placeholder showing the broken-image icon and the retry hint, and the image is not hidden

#### Scenario: The user retries successfully
- **WHEN** the user taps a placeholder and the image then loads
- **THEN** the image appears in place with its normal sizing and opens the gallery when tapped

#### Scenario: The retry fails again
- **WHEN** the user taps a placeholder and the reload fails
- **THEN** the placeholder returns and accepts another tap

#### Scenario: A highlighted image fails
- **WHEN** an image wrapped in a saved highlight fails to load
- **THEN** the placeholder appears inside the same highlight element and the highlight still resolves

### Requirement: Android uses an HTTP client with address-family fast fallback

The Android app SHALL resolve one OkHttp 5 version, 5.5.1 or newer within major version 5, for every OkHttp artifact. This includes the app-owned native modules, the React Native networking and image layers, and Expo modules. The client SHALL keep OkHttp's default IPv4/IPv6 fast fallback enabled. The app-owned clients' cookie, redirect, authentication, cache, timeout, and size policies SHALL be unchanged. React Native cookie handling, Fresco image loading, Expo fetch, and update downloads SHALL keep working.

#### Scenario: The resolved dependency graph is inspected
- **WHEN** the release runtime classpath of the Android app is resolved
- **THEN** every `com.squareup.okhttp3` artifact resolves to the same OkHttp 5 version

#### Scenario: A host's IPv6 path stalls
- **WHEN** an app-owned Android request targets a dual-stack host whose IPv6 connection does not complete
- **THEN** the request connects over IPv4 without waiting for the full IPv6 connect timeout
