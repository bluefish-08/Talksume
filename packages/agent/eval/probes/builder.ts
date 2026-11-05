import type { FactInput, IntakeState, ProfileChange, ToolRecord } from "../../src/index.ts";
import type { Target } from "../lib/target.ts";

/** 冻结状态的一轮台词：用户话、当时的助手回复，以及这一轮实际发生的写入。 */
export interface ScriptTurn {
  user: string;
  reply: string;
  /** 经真实的 upsert_facts 写入（quote 校验、暂存、冲突检测都照常）。 */
  facts?: FactInput[];
  /** 把上一条回复追问的字段记为跳过（等同 skipDeclined / skip_field）。 */
  skip?: boolean;
  complete?: { section: string; reason: "done" | "user_skipped"; quote?: string };
  /** 用户在这句里对待确认矛盾做了选择。 */
  choose?: "proposed" | "previous";
  /** 岗位工具的落库记录，两种回放模式都保留（线上 meta.tools 本来就有）。 */
  jobs?: ToolRecord[];
  /** 这条回复追问的字段：默认取规划器的下一个目标；正则按 key 指定；null 表示没有追问。 */
  slot?: RegExp | null;
}

export interface Script {
  turns: ScriptTurn[];
  /** 台词之后、探针发出之前对状态的调整，例如把剩余选填项都记为跳过。 */
  prepare?: (state: IntakeState, target: Target) => void;
  /** false：不累计 askCounts，复现审查实验 probe-skills.ts 的状态。 */
  countAsks?: boolean;
}

/** main：历史里只有岗位工具（S1a 之前）；intake：建档工具调用也回放（S1a）。 */
export type Replay = "main" | "intake";

/** 被测代码导出了 replayRecord 就说明它线上会回放建档调用，默认跟着它走。 */
export function defaultReplay(target: Target): Replay {
  return (target.agent as Partial<Target["agent"]>).replayRecord ? "intake" : "main";
}

type RawRecord = ToolRecord & { isError: boolean };

export interface BuiltState {
  state: IntakeState;
  /** 每轮工具的执行结果，用于检查台词本身有没有写进去。 */
  log: { turn: number; tool: string; result: string; isError: boolean }[];
}

type AnyTool = {
  name: string;
  prepareArguments?: (args: unknown) => unknown;
  execute: (
    id: string,
    params: unknown,
  ) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>;
};

export async function buildState(target: Target, script: Script, replay: Replay): Promise<BuiltState> {
  const A = target.agent;
  const replayRecord = (A as Partial<typeof A>).replayRecord;
  const state = A.createIntakeState({ profile: target.core.Profile.parse({}) });
  const genId = A.createIdGenerator();
  const log: BuiltState["log"] = [];
  const users: string[] = [];

  for (const [i, turn] of script.turns.entries()) {
    const round = i + 1;
    const id = `s${round}`;
    users.push(turn.user);
    const changes: ProfileChange[] = [];
    const flags = { asked: false, changed: false };
    const tools = A.createIntakeTools({
      state,
      messageId: id,
      userCorpus: A.buildUserCorpus(users),
      verifyQuote: true,
      genId,
      emit: (event) => {
        if (event.type === "profile_patch") changes.push(...event.changes);
      },
      flags,
      spoken: () => "",
    }) as unknown as AnyTool[];
    const records: RawRecord[] = [];
    const call = async (name: string, args: Record<string, unknown>) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`被测代码里没有工具 ${name}，探针台词需要改写`);
      let result: string;
      let isError = false;
      try {
        const params = tool.prepareArguments ? tool.prepareArguments(args) : args;
        const out = await tool.execute(`${id}_${records.length}`, params);
        result = out.content.map((c) => c.text ?? "").join("");
        isError = out.isError === true;
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
        isError = true;
      }
      records.push({ name, args, result, isError });
      log.push({
        turn: round,
        tool: name,
        result,
        isError: isError || /被拒绝|不合法|找不到|不是用户说过/.test(result),
      });
    };

    // 深挖项的简短拒答线上由 skipDeclined 在代码里跳过，不经模型，历史里也就没有 skip_field
    if (turn.skip && !A.skipDeclined(state, turn.user)) {
      const asked = A.lastAskedKey(state);
      const slot = asked ? A.skippableSlot(state, asked) : null;
      if (!slot) throw new Error(`第 ${round} 轮要跳过的字段 ${asked ?? "（无）"} 不存在`);
      A.skipSlot(state, slot, turn.user.slice(0, 40));
      records.push({
        name: "skip_field",
        args: { key: slot.key, quote: turn.user },
        result: `已记下用户不提供「${slot.label}」，以后不会再问。`,
        isError: false,
      });
    }
    if (turn.choose) {
      const conflict = state.conflicts[0];
      if (!conflict) throw new Error(`第 ${round} 轮没有待确认的矛盾`);
      await call("resolve_conflict", { factId: conflict.factId, choice: turn.choose, quote: turn.user });
    }
    if (turn.facts?.length) await call("upsert_facts", { facts: turn.facts });
    if (turn.complete) await call("complete_section", { ...turn.complete });

    let slotKey: string | undefined;
    if (turn.slot !== null && state.conflicts.length === 0) {
      let slot = turn.slot ? null : A.nextSlotOf(state);
      if (turn.slot) {
        const { missing } = A.computeCompleteness(state.profile, {
          completedSections: state.completedSections,
        });
        const hit = missing.find((m) => (turn.slot as RegExp).test(m.key));
        if (!hit) throw new Error(`第 ${round} 轮找不到匹配 ${turn.slot} 的待补字段`);
        slot = A.toSlot(hit);
      }
      if (slot) {
        if (script.countAsks !== false) A.noteAsked(state, slot);
        slotKey = slot.key;
      }
    }
    const intake = records.flatMap(({ name, args, result, isError }) => {
      if (!replayRecord) return [{ name, args, result }];
      return replayRecord(name, args, result, isError) ?? [];
    });
    const kept = replay === "intake" ? [...intake, ...(turn.jobs ?? [])] : (turn.jobs ?? []);
    state.history.push({ id, role: "user", content: turn.user });
    state.history.push({
      id: `${id}:reply`,
      role: "assistant",
      content: turn.reply,
      ...((changes.length || slotKey || kept.length) && {
        meta: {
          ...(changes.length > 0 ? { changes } : {}),
          ...(slotKey ? { slot: slotKey } : {}),
          ...(kept.length > 0 ? { tools: kept } : {}),
        },
      }),
    });
  }
  script.prepare?.(state, target);
  return { state, log };
}

/** 把所有剩余待问项记为跳过，模拟「该问的都问过了」。 */
export function exhaustPlanner(state: IntakeState, target: Target, quote = "没有了"): void {
  for (let guard = 0; guard < 80; guard++) {
    const slot = target.agent.nextSlotOf(state);
    if (!slot) return;
    target.agent.skipSlot(state, slot, quote);
  }
  throw new Error("规划器跳不完");
}
