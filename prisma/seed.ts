import "dotenv/config";
import { PrismaClient, Role, TaskType } from "@prisma/client";
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

  const admin = await prisma.user.upsert({
    where: { email: "admin@evalforge.dev" },
    update: {},
    create: {
      email: "admin@evalforge.dev",
      name: "Admin",
      passwordHash: adminPassword,
      role: Role.ADMIN,
    },
  });

  const annotators = await Promise.all(
    ["Alice", "Bob", "Charlie", "Diana", "Eve"].map((name) =>
      prisma.user.upsert({
        where: { email: `${name.toLowerCase()}@evalforge.dev` },
        update: {},
        create: {
          email: `${name.toLowerCase()}@evalforge.dev`,
          name,
          passwordHash: annotatorPassword,
          role: Role.ANNOTATOR,
        },
      })
    )
  );

  // ─── Models ──────────────────────────────────────
  const modelData = [
    { name: "CogVideoX-5B", provider: "THUDM", taskType: TaskType.T2V },
    { name: "Stable Video Diffusion", provider: "Stability AI", taskType: TaskType.I2V },
  ];

  const models = await Promise.all(
    modelData.map((m) =>
      prisma.model.upsert({
        where: { name: m.name },
        update: {},
        create: m,
      })
    )
  );

  // ─── Dimensions (6 for demo) ─────────────────────
  const dimensionData = [
    {
      code: "D1",
      nameZh: "视觉质量",
      nameEn: "Visual Quality",
      anchor: "画面清晰度、色彩准确性",
      testPoints: ["模糊", "色彩失真", "噪点"],
    },
    {
      code: "D2",
      nameZh: "运动合理性",
      nameEn: "Motion Rationality",
      anchor: "物理规律一致性",
      testPoints: ["穿模", "物体漂浮", "不自然加速"],
    },
    {
      code: "D3",
      nameZh: "时间一致性",
      nameEn: "Temporal Consistency",
      anchor: "帧间连贯性",
      testPoints: ["闪烁", "突变", "重影"],
    },
    {
      code: "D4",
      nameZh: "主体一致性",
      nameEn: "Subject Consistency",
      anchor: "角色/物体外观稳定",
      testPoints: ["变脸", "服装漂移", "遮挡后换人"],
    },
    {
      code: "D5",
      nameZh: "文本对齐",
      nameEn: "Text Alignment",
      anchor: "与 Prompt 语义匹配",
      testPoints: ["主体缺失", "动作错误", "场景不符"],
    },
    {
      code: "D6",
      nameZh: "美学质量",
      nameEn: "Aesthetic Quality",
      anchor: "构图与艺术表现力",
      testPoints: ["构图杂乱", "光影不自然", "缺乏层次"],
    },
  ];

  const dimensions = await Promise.all(
    dimensionData.map((d) =>
      prisma.dimension.upsert({
        where: { code: d.code },
        update: {},
        create: d,
      })
    )
  );

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

  const dimMap = new Map(dimensions.map((d) => [d.code, d.id]));

  for (const tag of failureTagData) {
    const dimensionId = dimMap.get(tag.dimCode);
    if (!dimensionId) continue;
    await prisma.failureTag.create({
      data: {
        labelZh: tag.labelZh,
        labelEn: tag.labelEn,
        dimensionId,
      },
    });
  }

  // ─── Prompts ─────────────────────────────────────
  const promptData = [
    {
      textZh: "一只金毛犬在海滩上奔跑",
      textEn: "A golden retriever running on a beach",
      taskType: TaskType.T2V,
    },
    {
      textZh: "城市天际线的延时摄影，从白天到夜晚",
      textEn: "Time-lapse of a city skyline from day to night",
      taskType: TaskType.T2V,
    },
    {
      textZh: "一位女士在厨房里做蛋糕",
      textEn: "A woman baking a cake in a kitchen",
      taskType: TaskType.T2V,
    },
    {
      textZh: "让图中的人物开始跳舞",
      textEn: "Make the person in the image start dancing",
      taskType: TaskType.I2V,
      sourceImage: "https://example.com/demo/person.jpg",
    },
  ];

  const prompts = await Promise.all(
    promptData.map((p) => prisma.prompt.create({ data: p }))
  );

  // ─── Video Assets (public sample videos) ──────────
  // Google-hosted sample videos (CC-licensed, publicly available)
  const sampleVideos = [
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  ];

  let videoIndex = 0;
  const videoAssets = [];
  for (const model of models) {
    const matchingPrompts = prompts.filter(
      (p) => p.taskType === model.taskType
    );
    for (const prompt of matchingPrompts) {
      const asset = await prisma.videoAsset.create({
        data: {
          url: sampleVideos[videoIndex % sampleVideos.length],
          durationSec: 6.0,
          width: 1280,
          height: 720,
          modelId: model.id,
          promptId: prompt.id,
        },
      });
      videoAssets.push(asset);
      videoIndex++;
    }
  }

  // ─── Evaluation Items (assign to annotators) ─────
  let assignIndex = 0;
  for (const asset of videoAssets) {
    // Each video gets 3 annotators (redundancy for IAA)
    for (let r = 0; r < 3; r++) {
      const annotator = annotators[assignIndex % annotators.length];
      await prisma.evaluationItem.create({
        data: {
          videoAssetId: asset.id,
          assignedToId: annotator.id,
        },
      });
      assignIndex++;
    }
  }

  console.log("✓ Seed complete:");
  console.log(`  ${1 + annotators.length} users`);
  console.log(`  ${models.length} models`);
  console.log(`  ${dimensions.length} dimensions`);
  console.log(`  ${prompts.length} prompts`);
  console.log(`  ${videoAssets.length} video assets`);
  console.log(`  ${videoAssets.length * 3} evaluation items`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
