type EventHandler<T> = T extends unknown ? (payload: T) => void : never;

export class EventBus<T extends Record<string, unknown> = Record<string, unknown>> {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private replayBuffer: Array<{ event: string; payload: unknown }>;
  private replaySize: number;

  constructor(replaySize = 500) {
    this.replaySize = replaySize;
    this.replayBuffer = [];
  }

  on<K extends keyof T & string>(event: K, handler: EventHandler<T[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  once<K extends keyof T & string>(event: K, handler: EventHandler<T[K]>): () => void {
    const wrapper = ((payload: unknown) => {
      this.off(event, wrapper as EventHandler<T[K]>);
      (handler as (payload: unknown) => void)(payload);
    }) as unknown as EventHandler<T[K]>;

    return this.on(event, wrapper);
  }

  off<K extends keyof T & string>(event: K, handler: EventHandler<T[K]>): void {
    this.listeners.get(event as string)?.delete(handler as (...args: unknown[]) => void);
  }

  emit<K extends keyof T & string>(event: K, payload: T[K]): void {
    // Store in replay buffer (ring buffer)
    this.replayBuffer.push({ event: event as string, payload });
    if (this.replayBuffer.length > this.replaySize) {
      this.replayBuffer.shift();
    }

    // Direct listeners
    const directListeners = this.listeners.get(event as string);
    if (directListeners) {
      for (const handler of directListeners) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[EventBus] Listener error for "${event}":`, error);
        }
      }
    }

    // Wildcard listeners
    const eventParts = (event as string).split('.');
    for (let i = eventParts.length - 1; i > 0; i--) {
      const wildcard = eventParts.slice(0, i).join('.') + '.*';
      const wildcardListeners = this.listeners.get(wildcard);
      if (wildcardListeners) {
        for (const handler of wildcardListeners) {
          try {
            handler(payload);
          } catch (error) {
            console.error(`[EventBus] Wildcard listener error for "${event}" (pattern "${wildcard}"):`, error);
          }
        }
      }
    }
  }

  replay(eventPattern?: string): Array<{ event: string; payload: unknown }> {
    if (!eventPattern) return [...this.replayBuffer];

    if (eventPattern.endsWith('.*')) {
      const prefix = eventPattern.slice(0, -2);
      return this.replayBuffer.filter((e) => e.event.startsWith(prefix + '.') || e.event === prefix);
    }

    return this.replayBuffer.filter((e) => e.event === eventPattern);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
