import "dotenv/config";
import {
  PrismaClient,
  Role,
  TaskType,
  AccountType,
  PackageStatus,
  EvaluationMode,
  ArenaVerdict,
  CapabilityTier,
  TagSource,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  // ─── Users ───────────────────────────────────────
  const adminPassword = await hash("admin123", 12);
  const annotatorPassword = await hash("eval123", 12);
  const viewerPassword = await hash("view123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@evalforge.dev" },
    update: {},
    create: {
      email: "admin@evalforge.dev",
      name: "Admin",
      passwordHash: adminPassword,
      role: Role.ADMIN,
      accountType: AccountType.INTERNAL,
    },
  });

  const internalNames = ["Alice", "Bob", "Charlie"];
  const vendorNames = ["Diana", "Eve"];

  const annotators = await Promise.all([
    ...internalNames.map((name) =>
      prisma.user.upsert({
        where: { email: `${name.toLowerCase()}@evalforge.dev` },
        update: {},
        create: {
          email: `${name.toLowerCase()}@evalforge.dev`,
          name,
          passwordHash: annotatorPassword,
          role: Role.ANNOTATOR,
          accountType: AccountType.INTERNAL,
          gender: "Female",
          ageRange: "25-34",
          city: "Beijing",
          education: "Bachelor",
        },
      })
    ),
    ...vendorNames.map((name) =>
      prisma.user.upsert({
        where: { email: `${name.toLowerCase()}@evalforge.dev` },
        update: {},
        create: {
          email: `${name.toLowerCase()}@evalforge.dev`,
          name,
          passwordHash: annotatorPassword,
          role: Role.VENDOR_ANNOTATOR,
          accountType: AccountType.VENDOR,
          gender: "Male",
          ageRange: "25-34",
          city: "Shanghai",
          education: "Master",
        },
      })
    ),
  ]);

  // VIEWER user (read-only stakeholder)
  const viewer = await prisma.user.upsert({
    where: { email: "viewer@evalforge.dev" },
    update: {},
    create: {
      email: "viewer@evalforge.dev",
      name: "Viewer Demo",
      passwordHash: viewerPassword,
      role: Role.VIEWER,
      accountType: AccountType.INTERNAL,
    },
  });

  // ─── Models (3: 2 T2V for arena pairing + 1 I2V) ─
  const modelData = [
    { name: "CogVideoX-5B", provider: "THUDM", taskType: TaskType.T2V },
    { name: "Mochi-1", provider: "Genmo", taskType: TaskType.T2V },
    { name: "Stable Video Diffusion", provider: "Stability AI", taskType: TaskType.I2V },
  ];
  const models = await Promise.all(
    modelData.map((m) =>
      prisma.model.upsert({ where: { name: m.name }, update: {}, create: m })
    )
  );
  const t2vModels = models.filter((m) => m.taskType === TaskType.T2V);
  const i2vModels = models.filter((m) => m.taskType === TaskType.I2V);

  // ─── Dimensions (6 for demo) ─────────────────────
  const dimensionData = [
    { code: "D1", nameZh: "视觉质量", nameEn: "Visual Quality", anchor: "画面清晰度、色彩准确性", testPoints: ["模糊", "色彩失真", "噪点"] },
    { code: "D2", nameZh: "运动合理性", nameEn: "Motion Rationality", anchor: "物理规律一致性", testPoints: ["穿模", "物体漂浮", "不自然加速"] },
    { code: "D3", nameZh: "时间一致性", nameEn: "Temporal Consistency", anchor: "帧间连贯性", testPoints: ["闪烁", "突变", "重影"] },
    { code: "D4", nameZh: "主体一致性", nameEn: "Subject Consistency", anchor: "角色/物体外观稳定", testPoints: ["变脸", "服装漂移", "遮挡后换人"] },
    { code: "D5", nameZh: "文本对齐", nameEn: "Text Alignment", anchor: "与 Prompt 语义匹配", testPoints: ["主体缺失", "动作错误", "场景不符"] },
    { code: "D6", nameZh: "美学质量", nameEn: "Aesthetic Quality", anchor: "构图与艺术表现力", testPoints: ["构图杂乱", "光影不自然", "缺乏层次"] },
  ];
  const dimensions = await Promise.all(
    dimensionData.map((d) =>
      prisma.dimension.upsert({ where: { code: d.code }, update: {}, create: d })
    )
  );
  const dimMap = new Map(dimensions.map((d) => [d.code, d.id]));

  // ─── Cleanup tables that re-seed cleanly via deleteMany ──
  await prisma.antiCheatEvent.deleteMany({});
  await prisma.score.deleteMany({});
  await prisma.arenaItem.deleteMany({});
  await prisma.evaluationItem.deleteMany({});
  await prisma.calibrationGroundTruth.deleteMany({});
  await prisma.viewerAssignment.deleteMany({});
  await prisma.userTag.deleteMany({});
  await prisma.groupMembership.deleteMany({});
  await prisma.capabilityAssessment.deleteMany({});
  await prisma.aggregatedScore.deleteMany({});
  await prisma.failureTag.deleteMany({});

  // ─── Failure Tags ────────────────────────────────
  const failureTagData: { labelZh: string; labelEn: string; dimCode: string }[] = [
    { labelZh: "模糊", labelEn: "Blurry", dimCode: "D1" },
    { labelZh: "色彩失真", labelEn: "Color distortion", dimCode: "D1" },
    { labelZh: "穿模", labelEn: "Clipping", dimCode: "D2" },
    { labelZh: "物体漂浮", labelEn: "Floating objects", dimCode: "D2" },
    { labelZh: "闪烁", labelEn: "Flickering", dimCode: "D3" },
    { labelZh: "突变", labelEn: "Abrupt change", dimCode: "D3" },
    { labelZh: "变脸", labelEn: "Face swap", dimCode: "D4" },
    { labelZh: "服装漂移", labelEn: "Clothing drift", dimCode: "D4" },
    { labelZh: "遮挡后换人", labelEn: "Identity swap after occlusion", dimCode: "D4" },
    { labelZh: "主体缺失", labelEn: "Missing subject", dimCode: "D5" },
    { labelZh: "动作错误", labelEn: "Wrong action", dimCode: "D5" },
    { labelZh: "构图杂乱", labelEn: "Messy composition", dimCode: "D6" },
    { labelZh: "光影不自然", labelEn: "Unnatural lighting", dimCode: "D6" },
  ];
  for (const tag of failureTagData) {
    const dimensionId = dimMap.get(tag.dimCode);
    if (!dimensionId) continue;
    await prisma.failureTag.create({
      data: { labelZh: tag.labelZh, labelEn: tag.labelEn, dimensionId },
    });
  }

  // ─── Annotator Tags + assignments ────────────────
  const tagSpecs = [
    { name: "通用", nameEn: "General" },
    { name: "运镜", nameEn: "Camera Motion" },
    { name: "物理规律", nameEn: "Physics" },
    { name: "美学", nameEn: "Aesthetics" },
  ];
  const annotatorTags = await Promise.all(
    tagSpecs.map((t) =>
      prisma.annotatorTag.upsert({
        where: { name: t.name },
        update: { nameEn: t.nameEn },
        create: t,
      })
    )
  );
  // Assign tags: Alice→运镜, Bob→物理规律+美学, Charlie→通用, Diana→通用, Eve→美学
  const tagAssignments: Array<{ userName: string; tagName: string; source?: TagSource; confidence?: number }> = [
    { userName: "Alice", tagName: "运镜" },
    { userName: "Bob", tagName: "物理规律" },
    { userName: "Bob", tagName: "美学", source: TagSource.AUTO_SUGGESTED, confidence: 0.78 },
    { userName: "Charlie", tagName: "通用" },
    { userName: "Diana", tagName: "通用" },
    { userName: "Eve", tagName: "美学" },
  ];
  for (const a of tagAssignments) {
    const user = annotators.find((u) => u.name === a.userName);
    const tag = annotatorTags.find((t) => t.name === a.tagName);
    if (!user || !tag) continue;
    await prisma.userTag.create({
      data: {
        userId: user.id,
        tagId: tag.id,
        source: a.source ?? TagSource.MANUAL,
        confidence: a.confidence,
      },
    });
  }

  // ─── Annotator Groups + memberships ──────────────
  const internalGroup = await prisma.annotatorGroup.upsert({
    where: { name: "Internal Reviewers" },
    update: {},
    create: {
      name: "Internal Reviewers",
      description: "Full-time evaluation team",
      location: "Beijing · Haidian",
      organization: "EvalForge In-house",
      monthlyQuota: 800,
    },
  });
  const vendorGroup = await prisma.annotatorGroup.upsert({
    where: { name: "Vendor Pool A" },
    update: {},
    create: {
      name: "Vendor Pool A",
      description: "Outsourced annotation partner",
      location: "Shanghai · Pudong",
      organization: "Demo Vendor Co.",
      monthlyQuota: 1200,
    },
  });
  // Alice is the group admin for Internal Reviewers
  for (const name of internalNames) {
    const user = annotators.find((u) => u.name === name);
    if (!user) continue;
    await prisma.groupMembership.upsert({
      where: { userId_groupId: { userId: user.id, groupId: internalGroup.id } },
      update: { isAdmin: name === "Alice" },
      create: { userId: user.id, groupId: internalGroup.id, isAdmin: name === "Alice" },
    });
  }
  for (const name of vendorNames) {
    const user = annotators.find((u) => u.name === name);
    if (!user) continue;
    await prisma.groupMembership.upsert({
      where: { userId_groupId: { userId: user.id, groupId: vendorGroup.id } },
      update: { isAdmin: name === "Diana" },
      create: { userId: user.id, groupId: vendorGroup.id, isAdmin: name === "Diana" },
    });
  }

  // ─── Prompts ─────────────────────────────────────
  const promptData = [
    { externalId: "T2V_001", textZh: "一只金毛犬在海滩上奔跑", textEn: "A golden retriever running on a beach", taskType: TaskType.T2V, category: "动物" },
    { externalId: "T2V_002", textZh: "城市天际线的延时摄影，从白天到夜晚", textEn: "Time-lapse of a city skyline from day to night", taskType: TaskType.T2V, category: "风景" },
    { externalId: "T2V_003", textZh: "一位女士在厨房里做蛋糕", textEn: "A woman baking a cake in a kitchen", taskType: TaskType.T2V, category: "人物" },
    { externalId: "I2V_001", textZh: "让图中的人物开始跳舞", textEn: "Make the person in the image start dancing", taskType: TaskType.I2V, sourceImage: "https://example.com/demo/person.jpg", sourceImagePrompt: "A young woman standing in a sunlit studio" },
  ];
  const prompts = await Promise.all(
    promptData.map((p) =>
      prisma.prompt.upsert({ where: { externalId: p.externalId }, update: {}, create: p })
    )
  );
  const t2vPrompts = prompts.filter((p) => p.taskType === TaskType.T2V);
  const i2vPrompts = prompts.filter((p) => p.taskType === TaskType.I2V);

  // ─── Prompt Suite (reusable across packages/datasets) ──
  const t2vSuite = await prisma.promptSuite.upsert({
    where: { name: "T2V Demo Suite v1" },
    update: {},
    create: {
      name: "T2V Demo Suite v1",
      description: "3 prompts × 6 dimensions for T2V evaluation",
      taskType: TaskType.T2V,
    },
  });
  const i2vSuite = await prisma.promptSuite.upsert({
    where: { name: "I2V Demo Suite v1" },
    update: {},
    create: {
      name: "I2V Demo Suite v1",
      description: "1 prompt × 6 dimensions for I2V evaluation",
      taskType: TaskType.I2V,
    },
  });
  // Suite entries: every prompt × every dimension
  let entryOrder = 0;
  for (const prompt of t2vPrompts) {
    for (const dim of dimensions) {
      await prisma.promptSuiteEntry.upsert({
        where: {
          promptSuiteId_promptId_dimensionId: {
            promptSuiteId: t2vSuite.id,
            promptId: prompt.id,
            dimensionId: dim.id,
          },
        },
        update: {},
        create: {
          promptSuiteId: t2vSuite.id,
          promptId: prompt.id,
          dimensionId: dim.id,
          sortOrder: entryOrder++,
        },
      });
    }
  }
  entryOrder = 0;
  for (const prompt of i2vPrompts) {
    for (const dim of dimensions) {
      await prisma.promptSuiteEntry.upsert({
        where: {
          promptSuiteId_promptId_dimensionId: {
            promptSuiteId: i2vSuite.id,
            promptId: prompt.id,
            dimensionId: dim.id,
          },
        },
        update: {},
        create: {
          promptSuiteId: i2vSuite.id,
          promptId: prompt.id,
          dimensionId: dim.id,
          sortOrder: entryOrder++,
        },
      });
    }
  }

  // ─── Image Set + Images (for I2V) ────────────────
  const i2vImageSet = await prisma.imageSet.upsert({
    where: { name: "I2V Demo Frames v1" },
    update: {},
    create: {
      name: "I2V Demo Frames v1",
      imageOssPrefix: "demo/i2v-frames/",
      imageCount: i2vPrompts.length,
      promptSuiteId: i2vSuite.id,
    },
  });
  for (const prompt of i2vPrompts) {
    await prisma.image.upsert({
      where: { imageSetId_promptId: { imageSetId: i2vImageSet.id, promptId: prompt.id } },
      update: {},
      create: {
        imageSetId: i2vImageSet.id,
        promptId: prompt.id,
        ossKey: `demo/i2v-frames/${prompt.externalId}.jpg`,
      },
    });
  }

  // ─── Datasets (model × promptSuite × imageSet) ───
  // Upsert by `name` (unique). The (modelId, promptSuiteId, imageSetId) compound
  // unique can't be queried with null imageSetId via Prisma's typed API even
  // though Postgres treats NULLs as distinct in unique constraints.
  const datasetSpecs = [
    ...t2vModels.map((m) => ({
      name: `${m.name.replace(/\s+/g, "")}_T2V_${t2vPrompts.length}_v1`,
      taskType: TaskType.T2V,
      videoOssPrefix: `demo/${m.name.toLowerCase().replace(/\s+/g, "-")}/t2v/`,
      videoCount: t2vPrompts.length,
      modelId: m.id,
      promptSuiteId: t2vSuite.id,
      imageSetId: null as string | null,
      frames: 121,
      resolution: "1280x720",
      duration: 6.0,
      aspect: "16:9",
    })),
    ...i2vModels.map((m) => ({
      name: `${m.name.replace(/\s+/g, "")}_I2V_${i2vPrompts.length}_v1`,
      taskType: TaskType.I2V,
      videoOssPrefix: `demo/${m.name.toLowerCase().replace(/\s+/g, "-")}/i2v/`,
      videoCount: i2vPrompts.length,
      modelId: m.id,
      promptSuiteId: i2vSuite.id,
      imageSetId: i2vImageSet.id as string | null,
      frames: 121,
      resolution: "1280x720",
      duration: 6.0,
      aspect: "16:9",
    })),
  ];
  const datasets = await Promise.all(
    datasetSpecs.map((spec) =>
      prisma.dataset.upsert({
        where: { name: spec.name },
        update: { videoCount: spec.videoCount },
        create: {
          name: spec.name,
          taskType: spec.taskType,
          videoOssPrefix: spec.videoOssPrefix,
          videoCount: spec.videoCount,
          modelId: spec.modelId,
          promptSuiteId: spec.promptSuiteId,
          ...(spec.imageSetId ? { imageSetId: spec.imageSetId } : {}),
          frames: spec.frames,
          resolution: spec.resolution,
          duration: spec.duration,
          aspect: spec.aspect,
        },
      })
    )
  );

  // ─── Video Assets (link to dataset for new flow) ─
  const sampleVideos = [
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4",
  ];
  let videoIndex = 0;
  const videoAssets: Awaited<ReturnType<typeof prisma.videoAsset.findFirst>>[] = [];
  for (const dataset of datasets) {
    const matchingPrompts = prompts.filter((p) => p.taskType === dataset.taskType);
    for (const prompt of matchingPrompts) {
      const asset = await prisma.videoAsset.upsert({
        where: { modelId_promptId: { modelId: dataset.modelId, promptId: prompt.id } },
        update: { datasetId: dataset.id },
        create: {
          url: sampleVideos[videoIndex % sampleVideos.length],
          durationSec: 6.0,
          width: 1280,
          height: 720,
          fps: 30,
          modelId: dataset.modelId,
          promptId: prompt.id,
          datasetId: dataset.id,
        },
      });
      videoAssets.push(asset);
      videoIndex++;
    }
  }

  // ─── Evaluation Packages ─────────────────────────
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10).replace(/-/g, "");

  const t2vScoringPkg = await prisma.evaluationPackage.upsert({
    where: { name: `T2V_Scoring_${todayStr}` },
    update: { status: PackageStatus.PUBLISHED, publishedAt: today, deletedAt: null },
    create: {
      name: `T2V_Scoring_${todayStr}`,
      taskType: TaskType.T2V,
      evaluationMode: EvaluationMode.SCORING,
      videoCount: t2vPrompts.length * t2vModels.length,
      annotatorCount: annotators.length,
      status: PackageStatus.PUBLISHED,
      publishedAt: today,
      modelCheckpoint: "cogvideox-5b-2026q2",
      promptSuiteId: t2vSuite.id,
      datasets: { connect: datasets.filter((d) => d.taskType === TaskType.T2V).map((d) => ({ id: d.id })) },
    },
  });

  const i2vScoringPkg = await prisma.evaluationPackage.upsert({
    where: { name: `I2V_Scoring_${todayStr}` },
    update: { status: PackageStatus.PUBLISHED, publishedAt: today, deletedAt: null },
    create: {
      name: `I2V_Scoring_${todayStr}`,
      taskType: TaskType.I2V,
      evaluationMode: EvaluationMode.SCORING,
      videoCount: i2vPrompts.length * i2vModels.length,
      annotatorCount: annotators.length,
      status: PackageStatus.PUBLISHED,
      publishedAt: today,
      modelCheckpoint: "svd-xt-2026q2",
      promptSuiteId: i2vSuite.id,
      datasets: { connect: datasets.filter((d) => d.taskType === TaskType.I2V).map((d) => ({ id: d.id })) },
    },
  });

  const arenaPkg = await prisma.evaluationPackage.upsert({
    where: { name: `T2V_Arena_${todayStr}` },
    update: { status: PackageStatus.PUBLISHED, publishedAt: today, deletedAt: null },
    create: {
      name: `T2V_Arena_${todayStr}`,
      taskType: TaskType.T2V,
      evaluationMode: EvaluationMode.ARENA,
      videoCount: t2vPrompts.length,
      annotatorCount: 3,
      status: PackageStatus.PUBLISHED,
      publishedAt: today,
      description: "CogVideoX-5B vs Mochi-1 pairwise comparison",
      promptSuiteId: t2vSuite.id,
      datasets: { connect: datasets.filter((d) => d.taskType === TaskType.T2V).map((d) => ({ id: d.id })) },
    },
  });

  const calibrationPkg = await prisma.evaluationPackage.upsert({
    where: { name: `T2V_Calibration_${todayStr}` },
    update: { status: PackageStatus.PUBLISHED, publishedAt: today, deletedAt: null },
    create: {
      name: `T2V_Calibration_${todayStr}`,
      taskType: TaskType.T2V,
      evaluationMode: EvaluationMode.SCORING,
      isCalibrationBatch: true,
      videoCount: 2,
      annotatorCount: annotators.length,
      status: PackageStatus.PUBLISHED,
      publishedAt: today,
      description: "Calibration batch with ground-truth scores for IRT scoring",
      promptSuiteId: t2vSuite.id,
    },
  });

  // ─── Backfill VideoAsset.packageId for SCORING packages ──
  for (const asset of videoAssets) {
    if (!asset) continue;
    const pkgId = asset.modelId && t2vModels.some((m) => m.id === asset.modelId)
      ? t2vScoringPkg.id
      : i2vScoringPkg.id;
    await prisma.videoAsset.update({ where: { id: asset.id }, data: { packageId: pkgId } });
  }

  // ─── Evaluation Items (SCORING — assign each asset×dim to 3 annotators) ──
  const t2vAssets = videoAssets.filter((a) => a && t2vModels.some((m) => m.id === a.modelId));
  const i2vAssets = videoAssets.filter((a) => a && i2vModels.some((m) => m.id === a.modelId));

  let assignIndex = 0;
  for (const asset of t2vAssets) {
    if (!asset) continue;
    // Pick 2 dimensions per video for breadth
    const pickedDims = [dimensions[(videoIndex++) % dimensions.length], dimensions[(videoIndex++) % dimensions.length]];
    for (const dim of pickedDims) {
      for (let r = 0; r < 3; r++) {
        const annotator = annotators[assignIndex % annotators.length];
        await prisma.evaluationItem.create({
          data: {
            videoAssetId: asset.id,
            dimensionId: dim.id,
            assignedToId: annotator.id,
            packageId: t2vScoringPkg.id,
          },
        });
        assignIndex++;
      }
    }
  }
  for (const asset of i2vAssets) {
    if (!asset) continue;
    const dim = dimensions[videoIndex++ % dimensions.length];
    for (let r = 0; r < 3; r++) {
      const annotator = annotators[assignIndex % annotators.length];
      await prisma.evaluationItem.create({
        data: {
          videoAssetId: asset.id,
          dimensionId: dim.id,
          assignedToId: annotator.id,
          packageId: i2vScoringPkg.id,
        },
      });
      assignIndex++;
    }
  }

  // ─── Arena Items (CogVideoX-5B vs Mochi-1 per prompt × dimension) ──
  const cogModel = t2vModels.find((m) => m.name === "CogVideoX-5B")!;
  const mochiModel = t2vModels.find((m) => m.name === "Mochi-1")!;
  let arenaIdx = 0;
  for (const prompt of t2vPrompts) {
    const leftAsset = videoAssets.find((a) => a?.modelId === cogModel.id && a?.promptId === prompt.id);
    const rightAsset = videoAssets.find((a) => a?.modelId === mochiModel.id && a?.promptId === prompt.id);
    if (!leftAsset || !rightAsset) continue;
    // 2 dims per arena item, assigned to first 3 annotators
    const pickedDims = [dimensions[arenaIdx % dimensions.length], dimensions[(arenaIdx + 1) % dimensions.length]];
    for (const dim of pickedDims) {
      for (let r = 0; r < 3; r++) {
        const annotator = annotators[r];
        await prisma.arenaItem.create({
          data: {
            packageId: arenaPkg.id,
            promptId: prompt.id,
            dimensionId: dim.id,
            videoAssetAId: leftAsset.id,
            videoAssetBId: rightAsset.id,
            assignedToId: annotator.id,
            // Pre-vote one for demo
            verdict: r === 0 ? ArenaVerdict.LEFT_WINS : null,
          },
        });
      }
    }
    arenaIdx++;
  }

  // ─── Calibration Ground Truths (for calibration package) ──
  const calibrationAssets = t2vAssets.slice(0, 2);
  for (const asset of calibrationAssets) {
    if (!asset) continue;
    for (const dim of dimensions.slice(0, 3)) {
      await prisma.calibrationGroundTruth.upsert({
        where: {
          packageId_videoAssetId_dimensionId: {
            packageId: calibrationPkg.id,
            videoAssetId: asset.id,
            dimensionId: dim.id,
          },
        },
        update: {},
        create: {
          packageId: calibrationPkg.id,
          videoAssetId: asset.id,
          dimensionId: dim.id,
          score: 4,
          failureTagIds: [],
          notes: "Sample expected score for calibration demo",
        },
      });
    }
  }

  // ─── Viewer Assignment ───────────────────────────
  for (const pkg of [t2vScoringPkg, i2vScoringPkg, arenaPkg]) {
    await prisma.viewerAssignment.upsert({
      where: { viewerId_packageId: { viewerId: viewer.id, packageId: pkg.id } },
      update: {},
      create: {
        viewerId: viewer.id,
        packageId: pkg.id,
        assignedBy: admin.id,
      },
    });
  }

  // ─── Capability Assessments (Bayesian IRT demo) ──
  const tierMap: Record<string, CapabilityTier> = {
    Alice: CapabilityTier.TIER_1,
    Bob: CapabilityTier.TIER_2,
    Charlie: CapabilityTier.TIER_2,
    Diana: CapabilityTier.TIER_3,
    Eve: CapabilityTier.TIER_3,
  };
  const assessmentSpecs = [
    { name: "Alice", accuracy: 9.2, consistency: 8.8, coverage: 8.5, detailOriented: 9.0, speed: 7.5, alphaMean: 1.42, alphaStd: 0.31, rankPercentile: 92 },
    { name: "Bob", accuracy: 7.8, consistency: 8.0, coverage: 7.2, detailOriented: 7.5, speed: 8.0, alphaMean: 0.65, alphaStd: 0.34, rankPercentile: 71 },
    { name: "Charlie", accuracy: 7.5, consistency: 7.2, coverage: 7.0, detailOriented: 7.0, speed: 7.8, alphaMean: 0.41, alphaStd: 0.36, rankPercentile: 58 },
    { name: "Diana", accuracy: 6.5, consistency: 6.8, coverage: 6.2, detailOriented: 6.0, speed: 8.5, alphaMean: -0.18, alphaStd: 0.40, rankPercentile: 35 },
    { name: "Eve", accuracy: 6.0, consistency: 6.2, coverage: 5.8, detailOriented: 5.5, speed: 8.8, alphaMean: -0.45, alphaStd: 0.42, rankPercentile: 22 },
  ];
  for (const spec of assessmentSpecs) {
    const user = annotators.find((u) => u.name === spec.name);
    if (!user) continue;
    const composite = (spec.accuracy * 0.3 + spec.consistency * 0.25 + spec.coverage * 0.15 + spec.detailOriented * 0.2 + spec.speed * 0.1);
    await prisma.capabilityAssessment.create({
      data: {
        userId: user.id,
        accuracy: spec.accuracy,
        consistency: spec.consistency,
        coverage: spec.coverage,
        detailOriented: spec.detailOriented,
        speed: spec.speed,
        compositeScore: Number(composite.toFixed(2)),
        alphaMean: spec.alphaMean,
        alphaStd: spec.alphaStd,
        alphaCILow: Number((spec.alphaMean - 1.96 * spec.alphaStd).toFixed(3)),
        alphaCIHigh: Number((spec.alphaMean + 1.96 * spec.alphaStd).toFixed(3)),
        rankPercentile: spec.rankPercentile,
        tier: tierMap[spec.name],
      },
    });
  }

  // ─── Aggregated Scores (sample daily rollup) ─────
  const aggDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (const model of models) {
    for (const dim of dimensions) {
      const avg = 3.5 + Math.random() * 1.0;
      await prisma.aggregatedScore.upsert({
        where: { date_modelId_dimensionId: { date: aggDate, modelId: model.id, dimensionId: dim.id } },
        update: {},
        create: {
          date: aggDate,
          modelId: model.id,
          dimensionId: dim.id,
          avgScore: Number(avg.toFixed(2)),
          stdDev: Number((0.4 + Math.random() * 0.4).toFixed(2)),
          count: 12,
        },
      });
    }
  }

  // ─── System Config (anti-cheat defaults) ─────────
  const defaultConfigs = [
    { key: "anti_cheat.min_watch_ratio", value: 0.7, label: "Minimum video watch ratio before submission" },
    { key: "anti_cheat.min_dwell_multiplier", value: 0.6, label: "Dwell time multiplier (durationSec × multiplier × 1000 = minDwellMs)" },
    { key: "anti_cheat.min_dwell_floor_ms", value: 5000, label: "Minimum dwell time floor (ms)" },
    { key: "anti_cheat.max_submits_per_hour", value: 60, label: "Maximum submissions per hour before flagging" },
    { key: "anti_cheat.fixed_value_threshold", value: 0.8, label: "Dominant value ratio threshold for fixed-value detection" },
    { key: "anti_cheat.low_variance_threshold", value: 0.5, label: "Score stddev threshold for low-variance detection" },
    { key: "anti_cheat.recent_scores_window", value: 20, label: "Number of recent scores for pattern detection" },
    { key: "display.hide_model_for_internal", value: 0, label: "Hide model name for internal annotators (0=show, 1=hide)" },
    { key: "display.hide_model_for_vendor", value: 0, label: "Hide model name for vendor annotators (0=show, 1=hide)" },
  ];
  for (const cfg of defaultConfigs) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: {},
      create: { key: cfg.key, value: cfg.value, label: cfg.label },
    });
  }

  // ─── Summary ─────────────────────────────────────
  const totals = {
    users: 1 + annotators.length + 1, // admin + annotators + viewer
    models: models.length,
    dimensions: dimensions.length,
    prompts: prompts.length,
    videoAssets: videoAssets.length,
    promptSuites: 2,
    imageSets: 1,
    datasets: datasets.length,
    packages: 4,
    arenaItems: await prisma.arenaItem.count(),
    evaluationItems: await prisma.evaluationItem.count(),
    capabilityAssessments: await prisma.capabilityAssessment.count(),
    aggregatedScores: await prisma.aggregatedScore.count(),
    annotatorTags: annotatorTags.length,
    annotatorGroups: 2,
    viewerAssignments: 3,
    calibrationGroundTruths: await prisma.calibrationGroundTruth.count(),
  };
  console.log("\n✓ Seed complete:");
  for (const [k, v] of Object.entries(totals)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("\n── Demo Credentials ────────────────────────");
  console.log(`  ADMIN:  admin@evalforge.dev / admin123`);
  console.log(`  ANNOT:  alice@evalforge.dev / eval123  (Internal · Group Admin)`);
  console.log(`  VENDOR: diana@evalforge.dev / eval123  (Vendor · Group Admin)`);
  console.log(`  VIEWER: viewer@evalforge.dev / view123 (Read-only)`);
  console.log("─────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
