import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { checkImageFile, deleteImage, uploadImage } from "../../api/images.ts";
import { useToast } from "../../components/Toast.tsx";

export const MAX_DRAFT_IMAGES = 2;

export interface DraftImage {
  key: string;
  name: string;
  /** 本地预览地址（objectURL），上传完成后仍用它显示。 */
  preview: string;
  status: "uploading" | "ready";
  id?: string;
  mimeType?: string;
}

let seq = 0;

/** 输入框里待发送的参考图：选中即上传，上传完成才算可发。 */
export function useImageDraft() {
  const toast = useToast();
  const [items, setItems] = useState<DraftImage[]>([]);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const add = useCallback(
    async (file: File) => {
      const problem = checkImageFile(file);
      if (problem) {
        toast(problem, { tone: "error" });
        return;
      }
      const key = `img${++seq}`;
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      let accepted = false;
      setItems((all) => {
        if (all.length >= MAX_DRAFT_IMAGES) return all;
        accepted = true;
        return [...all, { key, name: file.name, preview, status: "uploading" }];
      });
      await Promise.resolve();
      if (!accepted) {
        URL.revokeObjectURL(preview);
        previews.current.delete(preview);
        toast(`一次最多发 ${MAX_DRAFT_IMAGES} 张图`, { tone: "error" });
        return;
      }
      try {
        const uploaded = await uploadImage(file);
        setItems((all) =>
          all.map((i) =>
            i.key === key
              ? { ...i, status: "ready" as const, id: uploaded.id, mimeType: uploaded.mimeType }
              : i,
          ),
        );
      } catch (error) {
        setItems((all) => all.filter((i) => i.key !== key));
        toast(error instanceof ApiError ? error.message : "图片上传失败，请重试", { tone: "error" });
      }
    },
    [toast],
  );

  const remove = useCallback((key: string) => {
    setItems((all) => {
      const target = all.find((i) => i.key === key);
      if (target?.id) void deleteImage(target.id);
      return all.filter((i) => i.key !== key);
    });
  }, []);

  /** 发送成功后清空输入框里的图片，不删服务端（消息已经引用它）。 */
  const clear = useCallback(() => setItems([]), []);

  const uploading = items.some((i) => i.status === "uploading");
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const images = items.flatMap((i) => (i.id && i.mimeType ? [{ id: i.id, mimeType: i.mimeType }] : []));
  return { items, add, remove, clear, uploading, ids, images };
}

export type ImageDraft = ReturnType<typeof useImageDraft>;

/** 只发图不写字时的默认话术。 */
export const REPLICA_DEFAULT_TEXT = "帮我照着这张图的样式做我的简历";
