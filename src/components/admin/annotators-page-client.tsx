"use client";

import { useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n/context";
import {
  AssignmentManagementTab,
  type AssignmentAnnotatorRow,
  type AssignmentPkgGroup,
} from "@/components/admin/assignment-management-tab";
import {
  PeopleManagementTab,
  type PeopleRow,
} from "@/components/admin/people-management-tab";
import {
  GroupManagement,
  type GroupPackageAssignment,
} from "@/components/admin/group-management";
import { AssessmentBatchCreator } from "@/components/admin/assessment-batch-creator";
import { CredentialManagementTab } from "@/components/admin/credential-management-tab";
import type { CalibrationBatchSummary } from "@/app/(main)/admin/annotators/assessment-action";
import type { LeaderboardResponse } from "@/app/(main)/admin/annotators/leaderboard-action";

type TabId =
  | "assignment"
  | "people"
  | "groups"
  | "calibration"
  | "credentials";

interface CredentialRow {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  groupName: string | null;
  hasVault: boolean;
  lastResetAt: string | null;
}

// Slice the global pkgGroups down to per-group aggregates. For each group,
// emit one row per package that includes at least one of its members, with
// aggregate counts over those members only. This lets the drawer render
// "任务分配" without doing DB work on the client.
function buildPackagesByGroup(
  groupRows: { id: string; members: { userId: string }[] }[],
  pkgGroups: AssignmentPkgGroup[],
): Record<string, GroupPackageAssignment[]> {
  const out: Record<string, GroupPackageAssignment[]> = {};
  for (const g of groupRows) {
    const memberIds = new Set(g.members.map((m) => m.userId));
    const slices: GroupPackageAssignment[] = [];
    for (const pkg of pkgGroups) {
      const scoped = pkg.members.filter((m) => memberIds.has(m.userId));
      if (scoped.length === 0) continue;
      slices.push({
        packageId: pkg.packageId,
        packageName: pkg.packageName,
        taskType: pkg.taskType,
        evaluationMode: pkg.evaluationMode,
        deadline: pkg.deadline,
        memberCount: scoped.length,
        completed: scoped.reduce((acc, m) => acc + m.completed, 0),
        total: scoped.reduce((acc, m) => acc + m.total, 0),
      });
    }
    // Overdue-first, then earliest deadline, then name.
    slices.sort((a, b) => {
      const now = Date.now();
      const aOverdue =
        a.deadline != null && a.deadline.getTime() < now && a.completed < a.total;
      const bOverdue =
        b.deadline != null && b.deadline.getTime() < now && b.completed < b.total;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      if (a.deadline && b.deadline)
        return a.deadline.getTime() - b.deadline.getTime();
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return a.packageName.localeCompare(b.packageName, undefined, {
        numeric: true,
      });
    });
    out[g.id] = slices;
  }
  return out;
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  organization: string | null;
  monthlyQuota: number | null;
  members: Array<{
    userId: string;
    name: string;
    email: string;
    accountType: string;
    isAdmin: boolean;
  }>;
}

interface AvailableUser {
  id: string;
  name: string;
  email: string;
  accountType: string;
}

interface PackageInfo {
  id: string;
  name: string;
  taskType: string;
}

interface Props {
  activeTab: TabId;
  isAdmin: boolean;
  /** "SYSTEM" = full admin; "GROUP" = group-admin only. */
  scopeKind: "SYSTEM" | "GROUP";
  assignmentRows: AssignmentAnnotatorRow[];
  pkgGroups: AssignmentPkgGroup[];
  peopleRows: PeopleRow[];
  groupRows: GroupRow[];
  availableUsers: AvailableUser[];
  packages: PackageInfo[];
  selectedPackageId: string | null;
  calibrationBatches: CalibrationBatchSummary[];
  calibrationLeaderboard: LeaderboardResponse;
  credentialRows: CredentialRow[];
  currentUserId: string;
}

export function AnnotatorsPageClient({
  activeTab,
  isAdmin,
  scopeKind,
  assignmentRows,
  pkgGroups,
  peopleRows,
  groupRows,
  availableUsers,
  packages,
  selectedPackageId,
  calibrationBatches,
  calibrationLeaderboard,
  credentialRows,
  currentUserId,
}: Props) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleTabChange = useCallback(
    (nextTab: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", nextTab);
      // Switching tabs resets package filter — it's tab-specific
      if (nextTab !== "assignment") params.delete("pkg");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList variant="line" className="sr-only">
        <TabsTrigger value="assignment">
          {t("admin.annotators.tab.assignment")}
        </TabsTrigger>
        <TabsTrigger value="people">
          {t("admin.annotators.tab.people")}
        </TabsTrigger>
        <TabsTrigger value="groups">
          {t("admin.annotators.tab.groups")}
        </TabsTrigger>
        <TabsTrigger value="calibration">
          {t("admin.annotators.tab.calibration")}
        </TabsTrigger>
        <TabsTrigger value="credentials">
          {t("nav.annotators.credentials")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="assignment">
        <AssignmentManagementTab
          rows={assignmentRows}
          pkgGroups={pkgGroups}
          packages={packages}
          selectedPackageId={selectedPackageId}
          availableUsers={availableUsers}
        />
      </TabsContent>

      <TabsContent value="people">
        <PeopleManagementTab rows={peopleRows} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="groups">
        <GroupManagement
          groups={groupRows}
          availableUsers={availableUsers}
          peopleRows={peopleRows.map((p) => ({
            userId: p.userId,
            integrity: p.integrity,
            riskLevel: p.riskLevel,
            completed: p.completed,
            compositeScore: p.compositeScore ?? null,
            avgScore: p.avgScore ?? null,
            suspiciousCount: p.suspiciousCount ?? 0,
            total: p.total,
            trend: p.trend,
          }))}
          scope={scopeKind === "SYSTEM" ? "SYSTEM_ADMIN" : "GROUP_ADMIN"}
          packagesByGroup={buildPackagesByGroup(groupRows, pkgGroups)}
          autoOpenGroupId={
            scopeKind === "GROUP" && groupRows.length === 1
              ? groupRows[0].id
              : null
          }
          currentUserId={currentUserId}
        />
      </TabsContent>

      <TabsContent value="calibration">
        <AssessmentBatchCreator
          batches={calibrationBatches}
          leaderboard={calibrationLeaderboard}
          isAdmin={isAdmin && scopeKind === "SYSTEM"}
        />
      </TabsContent>

      {scopeKind === "SYSTEM" && (
        <TabsContent value="credentials">
          <CredentialManagementTab rows={credentialRows} />
        </TabsContent>
      )}
    </Tabs>
  );
}
