import type { Profile } from "@talksume/core";
import { createIntakeState, type IntakeController } from "../src/index.ts";
import type { Sample } from "./dataset.ts";
import { type Metrics, scoreProfile, summarize, type UnitResult } from "./metrics.ts";

export interface TranscriptTurn {
  user: string;
  assistant: string;
}

export interface SampleRun {
  sample: Sample;
  profile: Profile;
  units: UnitResult[];
  metrics: Metrics;
  completeness: number;
  asks: number;
  autoConfirmed: number;
  errors: { code: string; message: string }[];
  transcript: TranscriptTurn[];
  durationMs: number;
}

/** 额度用尽、鉴权失败等重试也无济于事的错误：整个评测应当停止。 */
export class EvalAbortError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EvalAbortError";
    this.code = code;
  }
}

export async function runSample(sample: Sample, controller: IntakeController): Promise<SampleRun> {
  const state = createIntakeState();
  const transcript: TranscriptTurn[] = [];
  const errors: { code: string; message: string }[] = [];
  let asks = 0;
  let autoConfirmed = 0;
  let completeness = 0;
  const startedAt = Date.now();

  for (const [index, text] of sample.turns.entries()) {
    let assistant = "";
    for await (const event of controller.handleUserMessage(state, {
      id: `${sample.id}-${index + 1}`,
      text,
    })) {
      if (event.type === "token") assistant += event.text;
      else if (event.type === "ask") {
        asks++;
        assistant += `${assistant ? "\n" : ""}${event.question}`;
      } else if (event.type === "completeness") completeness = event.completeness.score;
      else if (event.type === "error") {
        if (!event.recoverable) throw new EvalAbortError(event.code, event.message);
        errors.push({ code: event.code, message: event.message });
      }
    }
    transcript.push({ user: text, assistant });

    // 样例里的更正都是用户有意为之，自动以新说法为准。
    for (const conflict of [...state.conflicts]) {
      controller.confirmConflict(state, conflict.factId, true);
      autoConfirmed++;
    }
  }

  const units = scoreProfile(state.profile, sample.expected, sample.turns);
  return {
    sample,
    profile: state.profile,
    units,
    metrics: summarize(units),
    completeness,
    asks,
    autoConfirmed,
    errors,
    transcript,
    durationMs: Date.now() - startedAt,
  };
}
