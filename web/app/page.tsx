"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState<string>("checking...");

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`)
      .then((r) => r.json())
      .then((data) => setStatus(JSON.stringify(data)))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-xl">API health: {status}</p>
    </main>
  );
}
