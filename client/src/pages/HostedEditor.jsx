import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { hostedApi, localApi } from "../api";
import EditorPage from "./Editor";

export default function HostedEditorPage(props) {
  const { id } = useParams();

  useEffect(() => {
    let cancelled = false;

    const cacheProject = async () => {
      if (!id) return;
      try {
        const res = await hostedApi.get(`/projects/${id}`);
        if (cancelled) return;
        const project = res.data;
        const cacheId = project?.public_id || id;
        await localApi.post(`/ide/hosted-cache/${encodeURIComponent(cacheId)}`, { project });
      } catch {
        // Caching is opportunistic. Hosted editor errors are handled by EditorPage.
      }
    };

    cacheProject();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return <EditorPage {...props} />;
}
