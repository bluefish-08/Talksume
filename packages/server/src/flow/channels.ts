import type { PlatformConnector } from "@talksume/core";

export type ChannelPlan =
  | { channel: "hr_workspace" }
  | { channel: "platform_api"; connector: PlatformConnector }
  | { channel: "assisted" };

/** 按职位来源（jobs.source）登记平台连接器，例如以后接入飞书招聘时 register("feishu_hire", connector)。 */
export class ConnectorRegistry {
  readonly #bySource = new Map<string, PlatformConnector>();

  register(source: string, connector: PlatformConnector): this {
    this.#bySource.set(source, connector);
    return this;
  }

  resolve(source: string): ChannelPlan {
    if (source === "hr_workspace") return { channel: "hr_workspace" };
    const connector = this.#bySource.get(source);
    return connector ? { channel: "platform_api", connector } : { channel: "assisted" };
  }
}
