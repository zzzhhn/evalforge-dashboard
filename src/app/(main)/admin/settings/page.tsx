import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLocale, t } from "@/lib/i18n/server";
import { getSystemConfigs } from "./action";
import { SettingsClient } from "@/components/admin/settings-client";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    redirect("/tasks");
  }
  const locale = await getLocale();
  const configs = await getSystemConfigs();

  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold">{t(locale, "admin.settings.title")}</h1>
      </div>
      <SettingsClient configs={configs} />
    </div>
  );
}
