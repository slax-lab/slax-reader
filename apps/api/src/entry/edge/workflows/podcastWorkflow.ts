import { SocialMediaApi } from '@/infra/external/socialMedia'
import { container } from '@/decorators/di'
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { initializeInfrastructure, initializeCore } from '@/di/generated/dependency'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { PodcastArticleRepo, PodcastEpisodeRepo } from '@/infra/repository/dbPodcastArticle'
import { VertexAIClient } from '@/infra/external/vertexAIClient'
import { AssemblyAIClient } from '@/infra/external/assemblyAI'
import { OpenAIModerationClient } from '@/infra/external/openaiModeration'
import { fetchPublicText } from '@/infra/external/podcastFetch'
import { moderationSlices } from '@/utils/podcastTranscript'
import { PodcastService } from '@/domain/podcast'
import { runPodcastEpisode, PodcastStop, type PodcastStepLike, type PodcastWorkflowParams } from '@/domain/podcastRunner'

/**
 * One run for one podcast episode: transcript, article, bodies, translations. All logic is in
 * runPodcastEpisode; this class wires the real database, R2, model, AssemblyAI and moderation, and
 * turns the runner's stop errors into NonRetryableError so the engine does not retry them.
 */
export class PodcastWorkflow extends WorkflowEntrypoint<Env, PodcastWorkflowParams> {
  async run(event: WorkflowEvent<PodcastWorkflowParams>, step: WorkflowStep) {
    initializeCore()
    const currentContainer = container.clone()
    const ctxManager = new ContextManager(this.ctx, this.env)
    ctxManager.setUserInfo(0, 0, '', 'en')
    ctxManager.setHashIds(new Hashid(this.env))
    initializeInfrastructure(ctxManager, currentContainer)

    const service = currentContainer.resolve(PodcastService)
    const moderation = new OpenAIModerationClient(this.env)

    const stepLike: PodcastStepLike = {
      do: (name, config, fn) =>
        step.do(name, config as Parameters<WorkflowStep['do']>[1], async () => {
          try {
            return (await fn()) as any
          } catch (err) {
            if (err instanceof PodcastStop) throw new NonRetryableError(err.message)
            throw err
          }
        }) as any,
      sleep: (name, ms) => step.sleep(name, ms)
    }

    await runPodcastEpisode(
      {
        episodes: currentContainer.resolve(PodcastEpisodeRepo),
        articles: currentContainer.resolve(PodcastArticleRepo),
        bucket: this.env.OSS,
        model: new VertexAIClient(this.env),
        asr: new AssemblyAIClient(this.env.ASSEMBLYAI_API_KEY),
        fetchYoutubeCaption: async (videoId, language) => (await SocialMediaApi.fetchYoutubeCaption(this.env, videoId, language)).caption,
        fetchTranscript: url => fetchPublicText(url, { maxBytes: 5 * 1024 * 1024 }),
        moderate: async (title, text) => {
          let worst = 0
          for (const slice of moderationSlices(text)) {
            worst = Math.max(worst, await moderation.moderateContent({ title, text: slice }))
            if (worst >= 2) break
          }
          return worst
        },
        flagBookmarks: (sourceId, result) => service.flagBookmarks(sourceId, result),
        publishBodies: sourceId => service.publishBodies(ctxManager, sourceId),
        setRefsHash: (sourceId, hash) => service.setRefsHash(sourceId, hash),
        settleSnapshots: sourceId => service.settleSnapshots(ctxManager, sourceId),
        translationTargets: (sourceId, original) => service.translationTargets(sourceId, original),
        // One retry: a missed amount lets the site-wide budget gate under-count
        addCost: usd =>
          service
            .addCost(usd)
            .catch(() => service.addCost(usd))
            .catch(e => console.error(`podcast cost record failed after a retry: ${e}`))
      },
      event.payload,
      stepLike,
      event.instanceId
    )
  }
}
