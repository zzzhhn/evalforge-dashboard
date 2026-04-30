import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { getAdminScope } from "@/lib/admin-scope";
import { UndoToastProvider } from "@/components/providers/undo-toast-provider";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Group admins need a visual marker in the topbar so they understand
  // why their admin surfaces look restricted. Derived once here rather
  // than inside Topbar so we keep the client component pure.
  const scope = await getAdminScope(session);
  const isGroupAdmin = scope.kind === "GROUP";

  return (
    <UndoToastProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar role={session.role} isGroupAdmin={isGroupAdmin} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar
            name={session.name}
            role={session.role}
            isGroupAdmin={isGroupAdmin}
          />
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </UndoToastProvider>
  );
}
