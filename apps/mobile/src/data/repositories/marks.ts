import type {SqlDatabase} from './sql.ts';
import type {CollectionMarkPolicy, CreateMarkInput} from './types.ts';

export class MarkRepository {
  private readonly database: SqlDatabase;
  private readonly uuid: () => string;
  private readonly now: () => string;

  constructor(database: SqlDatabase, uuid: () => string, now: () => string) {
    this.database = database;
    this.uuid = uuid;
    this.now = now;
  }

  async addMark(input: CreateMarkInput): Promise<string> {
    const {markPolicy: policy, type} = input;
    if (policy.isCollection && !(type === 1 ? policy.allowLine : (type === 2 || type === 3) && policy.allowComment)) {
      throw new Error('Mark creation is not allowed');
    }
    const id = this.uuid();
    const metadata = {
      root_id: input.rootId ?? null,
      user_id: input.userId,
      parent_id: input.parentId ?? null,
      source_type: policy.isCollection ? 'collection' : null,
      source_id: policy.isCollection ? input.bookmarkId : null,
      bookmark_id: input.bookmarkId,
    };
    await this.database.writeTransaction(async tx => {
      await tx.execute(
        'INSERT INTO sr_bookmark_comment (id, type, source, user_bookmark_uuid, comment, approx_source, content, is_deleted, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
        [
          id,
          type,
          input.source?.length ? JSON.stringify(input.source) : '',
          input.bookmarkId,
          input.comment ?? '',
          input.approxSource ? JSON.stringify(input.approxSource) : '',
          JSON.stringify(input.selectContent ?? []),
          this.now(),
          JSON.stringify(metadata),
        ],
      );
    });
    return id;
  }

  async deleteMark(id: string, policy: CollectionMarkPolicy, userId: string): Promise<void> {
    await this.database.writeTransaction(async tx => {
      const mark = await tx.getOptional<{metadata: string}>(
        'SELECT metadata FROM sr_bookmark_comment WHERE id = ?', [id],
      );
      if (!mark) return;
      let owner: string | undefined;
      try {
        owner = (JSON.parse(mark.metadata) as {user_id?: string}).user_id;
      } catch {}
      if (!userId || (policy.isCollection && owner !== userId)) {
        throw new Error('Mark deletion is not allowed');
      }
      await tx.execute('UPDATE sr_bookmark_comment SET is_deleted = 1 WHERE id = ?', [id]);
    });
  }
}
