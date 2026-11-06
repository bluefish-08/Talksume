import { afterEach, describe, expect, it } from "vitest";
import { getExtensions, registerExtensions } from "./extensions.ts";

afterEach(() => registerExtensions({}));

describe("扩展点注册表", () => {
  it("默认什么都不注册，本地版直接进应用", () => {
    expect(getExtensions()).toEqual({});
  });

  it("注册后可以读到", () => {
    const publicRoutes = [{ path: "login" }];
    registerExtensions({ publicRoutes });
    expect(getExtensions().publicRoutes).toBe(publicRoutes);
  });
});
