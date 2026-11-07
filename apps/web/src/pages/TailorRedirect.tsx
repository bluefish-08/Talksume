import { Navigate, useParams } from "react-router";
import { Spinner } from "../components/ui.tsx";
import { tailorRedirectPath } from "../features/tailor/links.ts";
import { useTailoring } from "../features/tailor/queries.ts";

/** 旧的独立定制页地址：有生成它的对话就去对话，否则回岗位详情。 */
export function TailorRedirect() {
  const { jobId = "" } = useParams();
  const query = useTailoring(jobId);
  if (query.isPending) return <Spinner label="正在打开定制版" />;
  return <Navigate to={tailorRedirectPath(query.data, jobId)} replace />;
}
