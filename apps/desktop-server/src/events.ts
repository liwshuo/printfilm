/**
 * In-process event bus for SSE clients (adr-002 §5/§7).
 *
 * Publish/subscribe with topic filtering. Each subscriber holds an async
 * generator that yields queued events until unsubscribed. This is deliberately
 * single-process — DramaFlow Studio V1 is a local desktop app (repo-structure §2).
 */

export interface DomainEvent {
  /** Dot-namespaced topic, e.g. `review.run.finished`, `task.status.changed`. */
  topic: string;
  /** Project scope for filtering; omit for global events. */
  projectId?: string;
  /** Arbitrary payload; consumers rely on `topic` to interpret. */
  payload: Record<string, unknown>;
  /** ISO-8601 UTC timestamp assigned at publish time. */
  emittedAt: string;
}

type Subscriber = {
  id: number;
  projectId: string | undefined;
  push: (evt: DomainEvent) => void;
};

let nextSubId = 1;
const subscribers = new Map<number, Subscriber>();

export function publish(topic: string, payload: Record<string, unknown>, projectId?: string): void {
  const evt: DomainEvent = {
    topic,
    projectId,
    payload,
    emittedAt: new Date().toISOString(),
  };
  for (const s of subscribers.values()) {
    if (s.projectId && evt.projectId && s.projectId !== evt.projectId) continue;
    try {
      s.push(evt);
    } catch {
      // A misbehaving subscriber must not stop the fan-out.
    }
  }
}

/**
 * Subscribe to the bus. Returns an async iterable of events and an
 * `unsubscribe` fn. The iterable ends when `unsubscribe` is invoked (or the
 * consumer stops pulling) — SSE handlers use this to stream.
 */
export function subscribe(projectId?: string): {
  events: AsyncIterable<DomainEvent>;
  unsubscribe: () => void;
} {
  const id = nextSubId++;
  const queue: DomainEvent[] = [];
  let resolver: ((v: IteratorResult<DomainEvent>) => void) | null = null;
  let closed = false;

  const sub: Subscriber = {
    id,
    projectId,
    push: (evt) => {
      if (closed) return;
      if (resolver) {
        const r = resolver;
        resolver = null;
        r({ value: evt, done: false });
      } else {
        queue.push(evt);
      }
    },
  };
  subscribers.set(id, sub);

  const unsubscribe = (): void => {
    if (closed) return;
    closed = true;
    subscribers.delete(id);
    if (resolver) {
      const r = resolver;
      resolver = null;
      r({ value: undefined as never, done: true });
    }
  };

  const iterator: AsyncIterator<DomainEvent> = {
    next: () => {
      if (queue.length > 0) {
        const value = queue.shift() as DomainEvent;
        return Promise.resolve({ value, done: false });
      }
      if (closed) return Promise.resolve({ value: undefined as never, done: true });
      return new Promise((resolve) => {
        resolver = resolve;
      });
    },
    return: () => {
      unsubscribe();
      return Promise.resolve({ value: undefined as never, done: true });
    },
  };
  const events: AsyncIterable<DomainEvent> = {
    [Symbol.asyncIterator]: () => iterator,
  };
  return { events, unsubscribe };
}

/** Only for tests / debugging — reset the entire bus. */
export function _resetBus(): void {
  for (const s of subscribers.values()) {
    try {
      s.push({ topic: "bus.reset", payload: {}, emittedAt: new Date().toISOString() });
    } catch {
      // ignore
    }
  }
  subscribers.clear();
}
