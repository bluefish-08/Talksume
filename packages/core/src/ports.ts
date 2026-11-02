import type { ApplicationStatus, StatusChange } from "./application.ts";

export type Edition = "local" | "cloud";

export interface Notification {
  /** 持久化后才有；推送给前端时带上，便于去重与标记已读。 */
  id?: string;
  createdAt?: string;
  userId: string;
  kind: "status_changed" | "follow_up" | "interview_soon";
  title: string;
  refId: string;
}

export interface Notifier {
  notify(notification: Notification): Promise<void>;
}

export interface JobQueue {
  enqueue(name: string, payload: unknown, options?: { delayMs?: number; dedupeKey?: string }): Promise<void>;
}

export interface BlobStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export interface SubmitApplicationInput {
  jobExternalId: string;
  resumeFileKey: string;
  candidate: { name: string; email?: string; phone?: string };
}

export interface PlatformConnector {
  readonly platform: string;
  submit(input: SubmitApplicationInput): Promise<{ externalId: string; status: ApplicationStatus }>;
  fetchStatus(externalId: string): Promise<StatusChange | null>;
}
