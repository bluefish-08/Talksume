import { describe, expect, it } from "vitest";
import { buildJobInput, type JobFormValues } from "./jobForm.ts";

const base: JobFormValues = {
  title: "后端开发实习生",
  company: "示例科技",
  cities: "上海，杭州",
  jobType: "internship",
  salaryMin: "",
  salaryMax: "",
  degree: "",
  jdText: "负责服务端接口开发",
  tags: "Go, 后端",
  url: "",
};

describe("buildJobInput", () => {
  it("拆分城市和标签，空的可选项不提交", () => {
    const result = buildJobInput(base);
    expect(result).toEqual({
      input: {
        title: "后端开发实习生",
        company: "示例科技",
        cities: ["上海", "杭州"],
        jobType: "internship",
        jdText: "负责服务端接口开发",
        tags: ["Go", "后端"],
      },
    });
  });

  it("月薪按千元换算成元", () => {
    const result = buildJobInput({ ...base, salaryMin: "8", salaryMax: "12.5" });
    expect(result).toMatchObject({ input: { salaryMin: 8000, salaryMax: 12500 } });
  });

  it("必填项、薪资区间和链接都会校验", () => {
    const result = buildJobInput({
      ...base,
      title: " ",
      jdText: "",
      salaryMin: "20",
      salaryMax: "10",
      url: "example.com",
    });
    expect(result).toHaveProperty("errors");
    if ("errors" in result) {
      expect(Object.keys(result.errors).sort()).toEqual(["jdText", "salaryMax", "title", "url"]);
    }
  });
});
