import { EventEmitter } from "node:events";
import type { Notification, Notifier } from "@talksume/core";

export type NotificationListener = (notification: Notification) => void;

/** Notifier 加订阅能力；本地版用进程内实现，云端多实例用 Redis 实现。 */
export interface NotificationBus extends Notifier {
  subscribe(userId: string, listener: NotificationListener): Promise<() => void>;
}

export class InProcessNotifier implements NotificationBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    this.#emitter.setMaxListeners(0);
  }

  async notify(notification: Notification): Promise<void> {
    this.#emitter.emit(notification.userId, notification);
  }

  async subscribe(userId: string, listener: NotificationListener): Promise<() => void> {
    const safe: NotificationListener = (n) => {
      try {
        listener(n);
      } catch {
        // 单个连接写失败不能影响其他订阅者
      }
    };
    this.#emitter.on(userId, safe);
    return () => void this.#emitter.off(userId, safe);
  }
}

/** ioredis 里用到的最小子集，方便测试时替换。 */
export interface RedisPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}
export interface RedisSubscriber {
  psubscribe(pattern: string): Promise<unknown>;
  on(event: "pmessage", handler: (pattern: string, channel: string, message: string) => void): unknown;
}

const CHANNEL_PREFIX = "talksume:notify:";

/** 每个实例只开一条订阅连接，按 userId 在本进程内分发，所以 SSE 连接落在哪个实例都能收到。 */
export class RedisNotifier implements NotificationBus {
  readonly #pub: RedisPublisher;
  readonly #local = new InProcessNotifier();
  readonly #ready: Promise<unknown>;

  constructor(pub: RedisPublisher, sub: RedisSubscriber) {
    this.#pub = pub;
    sub.on("pmessage", (_pattern, channel, message) => {
      try {
        const notification = JSON.parse(message) as Notification;
        void this.#local.notify({ ...notification, userId: channel.slice(CHANNEL_PREFIX.length) });
      } catch {
        // 忽略格式不对的消息
      }
    });
    this.#ready = sub.psubscribe(`${CHANNEL_PREFIX}*`);
  }

  async notify(notification: Notification): Promise<void> {
    await this.#ready;
    await this.#pub.publish(`${CHANNEL_PREFIX}${notification.userId}`, JSON.stringify(notification));
  }

  subscribe(userId: string, listener: NotificationListener): Promise<() => void> {
    return this.#local.subscribe(userId, listener);
  }
}

export async function createRedisNotifier(
  url: string,
): Promise<{ notifier: RedisNotifier; close(): Promise<void> }> {
  const { Redis } = await import("ioredis");
  const pub = new Redis(url);
  const sub = pub.duplicate();
  return {
    notifier: new RedisNotifier(pub, sub),
    close: async () => {
      await Promise.all([pub.quit(), sub.quit()]);
    },
  };
}
