"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const TABS = [
  { href: "/balls", label: "Balls" },
  { href: "/inventory", label: "Inventory" },
  { href: "/plays", label: "Plays" },
  { href: "/ops", label: "Cabinet" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    await getSupabase().auth.signOut();
    router.replace("/login");
  };

  return (
    <header className="border-b">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/balls" className="font-semibold tracking-tight">
            Garra admin
          </Link>
          <nav className="flex items-center gap-1">
            {TABS.map((t) => {
              const active = pathname === t.href || pathname.startsWith(t.href + "/");
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
