import type { DOMProcessor, WebProcessorContext } from './types'

export class DOMPipeline {
  private processors: DOMProcessor[] = []

  register(processor: DOMProcessor): this {
    this.processors.push(processor)
    return this
  }

  async run(context: WebProcessorContext): Promise<void> {
    for (const processor of this.processors) {
      try {
        if (processor.match(context)) {
          await processor.process(context)
        }
      } catch (error) {
        console.error(`[${processor.name}]`, error)
      }
    }
  }
}
