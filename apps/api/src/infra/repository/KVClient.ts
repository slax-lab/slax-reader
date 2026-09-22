import { singleton } from '@/decorators/di'

@singleton()
export class KVClient {
  public kv: KVNamespace
  constructor(env: Env) {
    this.kv = env.KV
  }
}
