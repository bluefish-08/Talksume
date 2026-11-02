import { EventEmitter } from "node:events";
import type { Notification } from "@talksume/core";
import { describe, expect, it } from "vitest";
import { createRedisNotifier, InProcessNotifier, RedisNotifier } from "./bus.ts";

const make = (userId: string, title = "t"): Notification => ({
  userId,
  kind: "status_changed",
  title,
  refId: "r",
});

describe("InProcessNotifier", () => {
  it("只把通知推给对应用户的订阅者，取消订阅后不再收到", async () => {
    const bus = new InProcessNotifier();
    const a: Notification[] = [];
    const b: Notification[] = [];
    const stopA = await bus.subscribe("a", (n) => a.push(n));
    await bus.subscribe("b", (n) => b.push(n));

    await bus.notify(make("a", "1"));
    stopA();
    await bus.notify(make("a", "2"));
    await bus.notify(make("b", "3"));

    expect(a.map((n) => n.title)).toEqual(["1"]);
    expect(b.map((n) => n.title)).toEqual(["3"]);
  });

  it("订阅者抛错不影响其他订阅者", async () => {
    const bus = new InProcessNotifier();
    const got: Notification[] = [];
    await bus.subscribe("a", () => {
      throw new Error("socket closed");
    });
    await bus.subscribe("a", (n) => got.push(n));
    await bus.notify(make("a"));
    expect(got).toHaveLength(1);
  });
});

// 用一个内存里的假 Redis 模拟 publish / psubscribe 的跨实例投递
function fakeRedis() {
  const wire = new EventEmitter();
  const client = (): ConstructorParameters<typeof RedisNotifier>[0] &
    ConstructorParameters<typeof RedisNotifier>[1] => ({
    publish: async (channel, message) => {
      wire.emit("message", channel, message);
      return 1;
    },
    psubscribe: async () => undefined,
    on: (_event, handler) => {
      wire.on("message", (channel: string, message: string) =>
        handler("talksume:notify:*", channel, message),
      );
    },
  });
  return client;
}

describe("RedisNotifier", () => {
  it("实例 A 发布的通知能被实例 B 上的订阅者收到", async () => {
    const make2 = fakeRedis();
    const instanceA = new RedisNotifier(make2(), make2());
    const instanceB = new RedisNotifier(make2(), make2());
    const got: Notification[] = [];
    await instanceB.subscribe("u1", (n) => got.push(n));

    await instanceA.notify(make("u1", "hello"));
    await instanceA.notify(make("u2", "other"));

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ userId: "u1", title: "hello" });
  });
});

describe.skipIf(!process.env.REDIS_URL)("RedisNotifier (真实 Redis)", () => {
  it("经 Redis pub/sub 投递", async () => {
    const url = process.env.REDIS_URL ?? "";
    const a = await createRedisNotifier(url);
    const b = await createRedisNotifier(url);
    try {
      const userId = crypto.randomUUID();
      const got = new Promise<Notification>((resolve) => void b.notifier.subscribe(userId, resolve));
      await new Promise((r) => setTimeout(r, 100));
      await a.notifier.notify(make(userId, "via redis"));
      expect(await got).toMatchObject({ title: "via redis" });
    } finally {
      await a.close();
      await b.close();
    }
  });
});
