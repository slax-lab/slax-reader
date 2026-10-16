export type FixtureAction = {kind: string; [field: string]: unknown};
export type FixtureActionHandler = (action: FixtureAction) => boolean | Promise<boolean>;

/** Controlled state preparation is separate from native gesture and accessibility acceptance. */
export class FixtureActionRouter {
  private scope: string | null = null;
  private handlers = new Map<string, FixtureActionHandler>();
  activate(scope: string): () => void {
    if (this.scope !== null) throw new Error('A fixture action scope is already active');
    this.scope = scope;
    return () => {if (this.scope === scope) {this.scope = null; this.handlers.clear();}};
  }
  subscribe(name: string, handler: FixtureActionHandler): () => void {
    if (this.scope === null) throw new Error('Fixture actions require an active isolated runtime');
    if (this.handlers.has(name)) throw new Error(`Duplicate fixture action handler: ${name}`);
    this.handlers.set(name, handler);
    return () => {if (this.handlers.get(name) === handler) this.handlers.delete(name);};
  }
  async dispatch(action: FixtureAction): Promise<string> {
    if (this.scope === null) throw new Error('Fixture actions are disabled');
    if (!action || typeof action.kind !== 'string') throw new Error('Invalid fixture action');
    const scope = this.scope;
    for (const [name, handler] of [...this.handlers]) {
      if (this.scope !== scope) throw new Error('Fixture action scope was replaced');
      const handled = await handler(action);
      if (this.scope !== scope) throw new Error('Fixture action scope was replaced');
      if (handled) return name;
    }
    throw new Error(`Fixture action has no mounted handler: ${action.kind}`);
  }
}

export const fixtureActions = new FixtureActionRouter();
