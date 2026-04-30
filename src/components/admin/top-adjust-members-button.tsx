"use client";

import { useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import { PackageMemberAdjustDialog } from "@/components/admin/package-member-adjust-dialog";

// Page-level trigger for the "Adjust by Package" dialog on the Task Mgmt
// page header. Sibling to "+ 新建任务". The dialog itself lets the admin
// pick which package to operate on, then shows current vs candidate
// members — identical UX to the legacy Assignment tab's bulk action, just
// surfaced higher in the navigation.

interface PackageEntry {
  id: string;
  name: string;
  taskType: string;
  currentMembers: Array<{
    id: string;
    name: string;
    email: string;
    accountType: string;
    completed: number;
    total: number;
  }>;
}

interface AvailableUser {
  id: string;
  name: string;
  email: string;
  accountType: string;
}

interface Props {
  packages: PackageEntry[];
  availableUsers: AvailableUser[];
}

export function TopAdjustMembersButton({ packages, availableUsers }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  const currentMembersByPkg = useMemo(() => {
    const map = new Map<string, PackageEntry["currentMembers"]>();
    for (const p of packages) map.set(p.id, p.currentMembers);
    return map;
  }, [packages]);

  const dialogPackages = useMemo(
    () =>
      packages.map((p) => ({
        id: p.id,
        name: p.name,
        taskType: p.taskType,
      })),
    [packages],
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5"
        onClick={() => setOpen(true)}
        disabled={packages.length === 0}
      >
        <Settings2 className="h-4 w-4" strokeWidth={1.75} />
        {t("admin.annotators.assignment.adjustByPackage")}
      </Button>
      <PackageMemberAdjustDialog
        open={open}
        onClose={() => setOpen(false)}
        packages={dialogPackages}
        currentMembersByPkg={currentMembersByPkg}
        allUsers={availableUsers}
      />
    </>
  );
}
