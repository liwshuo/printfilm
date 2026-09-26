/**
 * Shared primitive aliases and base entity shapes.
 * Authority: data-and-api-v1.md §6.
 */

export type Id = string;
export type IsoTime = string;

/** Mutable core entity: carries created/updated timestamps. */
export interface BaseEntity {
  id: Id;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}

/** Append-only entity: no update timestamp (logs / events). */
export interface AppendOnlyEntity {
  id: Id;
  createdAt: IsoTime;
}
