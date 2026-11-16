# Concurrent YouTube article generation

YouTube generation now processes up to five chunks concurrently.
Each chunk uses bounded source context and preserves edit-before-translation order.
The runner assembles completed chunks in source order and keeps coverage checks before publication.

Concurrent requests reserve spending capacity before calling the model.
Accounting errors stop new requests. Failed batches wait for active chunks and retain successful results for retry.
Model requests receive cancellation deadlines. Model-call and chunk events record elapsed milliseconds without transcript text.

No client interface, article response format, model selection, or spending limit changes.
