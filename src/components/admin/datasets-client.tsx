"use client";

import { useState, useEffect } from "react";
import { useLocale } from "@/lib/i18n/context";
import {
  DatasetSidebar,
  type SidebarDataset,
} from "@/components/admin/dataset-sidebar";
import {
  DatasetDetailPanel,
  type DetailDataset,
} from "@/components/admin/dataset-detail-panel";
import {
  DatasetCreateWizard,
  type WizardModel,
  type WizardPromptSuite,
} from "@/components/admin/dataset-create-wizard";

interface Props {
  datasets: DetailDataset[];
  promptSuites: WizardPromptSuite[];
  models: WizardModel[];
}

export function DatasetsClient({ datasets, promptSuites, models }: Props) {
  const { t } = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(
    datasets[0]?.id ?? null,
  );
  const [isCreating, setIsCreating] = useState(false);

  // Keep selection valid when the dataset list changes (create/delete).
  useEffect(() => {
    if (selectedId && !datasets.find((d) => d.id === selectedId)) {
      setSelectedId(datasets[0]?.id ?? null);
    }
  }, [datasets, selectedId]);

  const sidebarData: SidebarDataset[] = datasets.map((d) => ({
    id: d.id,
    name: d.name,
    taskType: d.taskType,
    videoCount: d.videoCount,
    modelName: d.model.name,
    packageCount: d.packageCount,
  }));

  const selected = datasets.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="grid h-full grid-cols-[18rem_1fr] gap-4">
      <aside className="min-h-0 overflow-hidden">
        <DatasetSidebar
          datasets={sidebarData}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setIsCreating(false);
          }}
          onNewClick={() => setIsCreating(true)}
          isCreating={isCreating}
        />
      </aside>
      <main className="min-h-0 overflow-hidden">
        {isCreating ? (
          <DatasetCreateWizard
            promptSuites={promptSuites}
            models={models}
            existingDatasets={datasets.map((d) => ({
              id: d.id,
              name: d.name,
              taskType: d.taskType,
              promptSuiteId: d.promptSuite.id,
              videoOssPrefix: d.videoOssPrefix,
              modelName: d.model.name,
            }))}
            onCancel={() => setIsCreating(false)}
            onCreated={(datasetId) => {
              setIsCreating(false);
              setSelectedId(datasetId);
            }}
          />
        ) : selected ? (
          <DatasetDetailPanel dataset={selected} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
            {t("admin.datasets.empty")}
          </div>
        )}
      </main>
    </div>
  );
}
