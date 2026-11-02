// 一次性工具：录制各接口的小样本到 src/fixtures，供单测离线使用。
import { mkdirSync, writeFileSync } from "node:fs";
import { createHttpClient } from "./http.ts";

const http = createHttpClient();
const dir = new URL("./fixtures/", import.meta.url);
mkdirSync(dir, { recursive: true });
const save = (name: string, data: unknown) =>
  writeFileSync(new URL(name, dir), `${JSON.stringify(data, null, 2)}\n`);

type R = Record<string, unknown>;

// 腾讯校招/实习
const jq = "https://join.qq.com/api/v1";
const jqBody = (pageIndex: number) => ({
  projectIdList: [],
  projectMappingIdList: [],
  keyword: "",
  bgList: [],
  workCountryType: 0,
  workCityList: [],
  recruitCityList: [],
  positionFidList: [],
  pageIndex,
  pageSize: 100,
});
const jqAll: R[] = [];
for (let i = 1; i <= 11; i++) {
  const page = await http.json<{ data: { positionList: R[] } }>(`${jq}/position/searchPosition`, {
    json: jqBody(i),
  });
  jqAll.push(...page.data.positionList);
}
const campus = jqAll.find((p) => p.projectId === 1);
const intern = jqAll.find((p) => p.projectId === 2);
const jqDetail = async (p: R | undefined) => {
  const d = (await http.json<{ data: R }>(`${jq}/jobDetails/getJobDetailsByPostId?postId=${p?.postId}`)).data;
  const bgs = (d.intentionBGDList as R[]).map(({ id, title, showTitle }) => ({ id, title, showTitle }));
  return { ...d, intentionBGDList: bgs };
};
save("tencent-campus.json", {
  items: [campus, intern],
  details: [await jqDetail(campus), await jqDetail(intern)],
});

// 腾讯社招
const tc = "https://careers.tencent.com/tencentcareer/api/post";
const tcList = await http.json<{ Data: { Posts: R[] } }>(
  `${tc}/Query?pageIndex=1&pageSize=3&language=zh-cn&attrId=1&countryId=1`,
);
const tcPost = tcList.Data.Posts[0];
const tcDetail = await http.json<{ Data: R }>(`${tc}/ByPostId?postId=${tcPost?.PostId}&language=zh-cn`);
save("tencent-social.json", { items: [tcPost], details: [tcDetail.Data] });

// 网易
const ne = "https://hr.163.com/api/hr163/position/queryPage";
const neItems: R[] = [];
for (const workType of ["1", "0"]) {
  const d = await http.json<{ data: { list: R[] } }>(ne, {
    json: { currentPage: 1, pageSize: 2, keyword: "", workType },
  });
  neItems.push(...d.data.list);
}
save("netease.json", { items: neItems });

// 美团
const mt = "https://zhaopin.meituan.com/api/official/job/getJobList";
const mtItems: R[] = [];
for (const code of ["1", "2", "3"]) {
  const d = await http.json<{ data: { list: R[] } }>(mt, {
    json: {
      page: { pageNo: 1, pageSize: 1 },
      jobShareType: "1",
      keywords: "",
      cityList: [],
      department: [],
      jfJgList: [],
      jobType: [{ code, subCode: [] }],
      typeCode: [],
      specialCode: [],
    },
  });
  mtItems.push(...d.data.list);
}
save("meituan.json", { items: mtItems });

// 米哈游
const mh = "https://ats.openout.mihoyo.com/ats-portal/v1";
const mhList = await http.json<{ data: { list: R[] } }>(`${mh}/job/list`, {
  json: { pageNo: 1, pageSize: 50, channelDetailIds: [1], hireType: 1, orderBy: "", isTop: false },
});
const mhCampus = mhList.data.list.find((x) => x.jobNature === "全职");
const mhIntern = mhList.data.list.find((x) => x.jobNature === "实习");
const mhDetail = async (x: R | undefined) =>
  (
    await http.json<{ data: R }>(`${mh}/job/info`, {
      json: { id: x?.id, channelDetailIds: [1], hireType: 1 },
    })
  ).data;
save("mihoyo.json", {
  items: [mhCampus, mhIntern],
  details: [await mhDetail(mhCampus), await mhDetail(mhIntern)],
});
console.log("done");
