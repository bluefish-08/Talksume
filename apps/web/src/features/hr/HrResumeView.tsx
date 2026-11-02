import { type ResumeContent, resolveResumeStyle } from "@talksume/core";
import { ResumePreview } from "../resume/ResumePreview.tsx";

/** HR 看到的和候选人投递时选的模板、强调色一致。 */
export function HrResumeView({
  content,
  template,
  accent,
}: {
  content: ResumeContent;
  template?: string;
  accent?: string;
}) {
  return (
    <ResumePreview
      resume={content}
      resumeStyle={resolveResumeStyle({ template, accent })}
      decorated={false}
      label={`${content.basics.name}的简历`}
    />
  );
}
