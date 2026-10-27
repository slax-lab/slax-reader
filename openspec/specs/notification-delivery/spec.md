# notification-delivery Specification

## Purpose
Deliver configured Reader notifications from Cloudflare Workers while preserving their destinations, message formats, and suppression rules.

## Requirements

### Requirement: Compatible notification requests

The system SHALL send configured Feishu topic cards, Feishu report cards, and WeCom messages using request options accepted by the Cloudflare Workers runtime. It SHALL preserve existing payload formats and crawl environment tags. Local execution and missing destinations SHALL continue to suppress outbound notifications.

#### Scenario: Configured notification succeeds
- **WHEN** a configured non-local notification endpoint accepts the request with an HTTP success response
- **THEN** the notification transport completes without a redirect-option error and sends the existing message payload to that endpoint

#### Scenario: Notification is suppressed
- **WHEN** the destination is absent or the environment is local
- **THEN** the system makes no outbound notification request

### Requirement: Notification destinations are not redirected

The notification transport SHALL reject HTTP redirects without following their destinations. It SHALL also reject other unsuccessful HTTP responses. These rejection errors SHALL identify the HTTP status without exposing the webhook URL, redirect location, response body, or notification content.

#### Scenario: Endpoint redirects
- **WHEN** a notification endpoint responds with an HTTP redirect
- **THEN** the transport rejects the response without sending the payload to the redirect destination

#### Scenario: Endpoint rejects the request
- **WHEN** a notification endpoint responds with an HTTP client or server error
- **THEN** the transport rejects with the HTTP status and omits private endpoint and response details from its error
