import { useEffect, useState } from "react";

interface Meta {
  edition: string;
  version: string;
}

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/meta")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setMeta)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1>简聊 Talksume</h1>
      <p>聊出好简历，投中好岗位</p>
      {meta && (
        <p>
          服务端：{meta.edition} · {meta.version}
        </p>
      )}
      {error && <p role="alert">服务端不可用：{error}</p>}
    </main>
  );
}
