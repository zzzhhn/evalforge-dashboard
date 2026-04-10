/**
 * Workstation uses a dedicated full-width layout (no sidebar)
 * to maximize video viewing area — "focus mode" per the plan.
 */
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function WorkstationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen flex-col bg-background">
      {children}
    </div>
  );
}
