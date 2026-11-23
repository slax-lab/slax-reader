// Every infrastructure provider, for tools and tests that need the complete set.
import { provide as VectorEmbeddingClient } from './VectorEmbeddingClient'
import { provide as VectorSourceRepo } from './VectorSourceRepo'
import { provide as VectorIndexClient } from './VectorIndexClient'
import { provide as VectorPreferenceClient } from './VectorPreferenceClient'
import { provide as VectorPreferenceStores } from './VectorPreferenceStores'
import { provide as PRISIMA_CLIENT } from './PRISIMA_CLIENT'
import { provide as PRISIMA_FULLTEXT_CLIENT } from './PRISIMA_FULLTEXT_CLIENT'
import { provide as PRISIMA_HYPERDRIVE_CLIENT } from './PRISIMA_HYPERDRIVE_CLIENT'
import { provide as PRISMA_LOGS_CLIENT } from './PRISMA_LOGS_CLIENT'
import { provide as VECTORIZE_CLIENTS } from './VECTORIZE_CLIENTS'
import { provide as GEMINI_AGENT } from './GEMINI_AGENT'
import { provide as StripeClient } from './StripeClient'
import { provide as RedisClient } from './RedisClient'
import { provide as BucketClient } from './BucketClient'
import { provide as KVClient } from './KVClient'
import { provide as QueueClient } from './QueueClient'
import { provide as SlaxAlertBotClient } from './SlaxAlertBotClient'
import { provide as GEMINI_BATCH_PROVIDER } from './GEMINI_BATCH_PROVIDER'
import { provide as GA4AnalyticsClient } from './GA4AnalyticsClient'

export const allInfrastructureProviders = [
  VectorEmbeddingClient,
  VectorSourceRepo,
  VectorIndexClient,
  VectorPreferenceClient,
  VectorPreferenceStores,
  PRISIMA_CLIENT,
  PRISIMA_FULLTEXT_CLIENT,
  PRISIMA_HYPERDRIVE_CLIENT,
  PRISMA_LOGS_CLIENT,
  VECTORIZE_CLIENTS,
  GEMINI_AGENT,
  StripeClient,
  RedisClient,
  BucketClient,
  KVClient,
  QueueClient,
  SlaxAlertBotClient,
  GEMINI_BATCH_PROVIDER,
  GA4AnalyticsClient
]
