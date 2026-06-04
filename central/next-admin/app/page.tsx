"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

// Root: bounce to /balls if signed in, /login otherwise. Avoids rendering
// anything decision-shaped at "/".
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    getSupabase().auth.getSession().then(({ data }) => {
      router.replace(data.session ? "/balls" : "/login");
    });
  }, [router]);
  return null;
}
