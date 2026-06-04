import RequireAuth from "@/components/RequireAuth";
import NavBar from "@/components/NavBar";

// Route group: every page under (app)/ runs behind RequireAuth and shows
// the NavBar. /login lives outside this group so it isn't gated.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main className="container py-6">{children}</main>
      </div>
    </RequireAuth>
  );
}
