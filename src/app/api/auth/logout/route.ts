import { clearSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function POST() {
  await clearSession();
  redirect("/login");
}
