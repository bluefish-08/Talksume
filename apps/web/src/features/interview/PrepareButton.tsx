import { useNavigate } from "react-router";
import { Button } from "../../components/ui.tsx";
import { interviewPath } from "./queries.ts";

export function PrepareInterviewButton({
  jobId,
  size = "md",
  className,
}: {
  jobId: string;
  size?: "sm" | "md" | "lg";
  className?: string | undefined;
}) {
  const navigate = useNavigate();
  return (
    <Button size={size} className={className} onClick={() => navigate(interviewPath(jobId))}>
      准备面试
    </Button>
  );
}
