interface CollectionSource {id: string; hasNew: boolean}
export interface CollectionSelectionChange {id: string | null; markRead: string | null}

/** Selection survives list updates until the subscribed collection is removed. */
export class CollectionSelection {
  private current: string | null = null;
  select(id: string | null, collections: readonly CollectionSource[]): CollectionSelectionChange | null {
    const source = id === null ? null : collections.find(value => value.id === id);
    if ((id !== null && !source) || id === this.current) return null;
    this.current = id;
    return {id, markRead: source?.hasNew ? source.id : null};
  }
  reconcile(collections: readonly CollectionSource[]): CollectionSelectionChange | null {
    return this.current !== null && !collections.some(value => value.id === this.current)
      ? this.select(null, collections) : null;
  }
}
