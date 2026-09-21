"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth";

// Root: bounce to /balls if signed in, /login otherwise. Avoids rendering
// anything decision-shaped at "/".
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      router.replace(data?.session ? "/balls" : "/login");
    });
  }, [router]);
  return null;
}
