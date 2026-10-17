import { container } from '@/decorators/di'
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { initializeInfrastructure, initializeCore } from '@/di/generated/dependency'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { YoutubeArticleRepo } from '@/infra/repository/dbYoutubeArticle'
import { VertexAIClient } from '@/infra/external/vertexAIClient'
import { YoutubeArticleService, type YoutubeArticleWorkflowParams } from '@/domain/youtubeArticle'
import { runYoutubeArticle, YoutubeArticleStop, type StepLike } from '@/domain/youtubeArticleRunner'

/**
 * YouTube AI article generation for one canonical row. All logic is in runYoutubeArticle; this
 * class only wires the real database, R2 bucket and model, and turns the runner's stop errors
 * into NonRetryableError so the engine does not retry them.
 */
export class YoutubeArticleWorkflow extends WorkflowEntrypoint<Env, YoutubeArticleWorkflowParams> {
  async run(event: WorkflowEvent<YoutubeArticleWorkflowParams>, step: WorkflowStep) {
    initializeCore()
    const currentContainer = container.clone()
    const ctxManager = new ContextManager(this.ctx, this.env)
    ctxManager.setUserInfo(0, 0, '', 'en')
    ctxManager.setHashIds(new Hashid(this.env))
    initializeInfrastructure(ctxManager, currentContainer)

    const repo = currentContainer.resolve(YoutubeArticleRepo)
    const service = currentContainer.resolve(YoutubeArticleService)
    const model = new VertexAIClient(this.env)

    const stepLike: StepLike = {
      do: (name, config, fn) =>
        step.do(name, config as Parameters<WorkflowStep['do']>[1], async () => {
          try {
            return (await fn()) as any
          } catch (err) {
            if (err instanceof YoutubeArticleStop) throw new NonRetryableError(err.message)
            throw err
          }
        }) as any
    }

    await runYoutubeArticle(
      {
        repo,
        bucket: this.env.OSS,
        model,
        addCost: usd => service.addCost(usd).catch(e => console.error(`youtube article cost record failed: ${e}`)),
        publishBodies: articleId => service.publishBodies(ctxManager, articleId)
      },
      event.payload,
      stepLike,
      event.instanceId
    )
  }
}
