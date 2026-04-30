import { createHmac } from "crypto";
import { prisma } from "@/lib/db";

const OSS_BUCKET = process.env.OSS_BUCKET_NAME ?? "evalforge-demo-bucket";
const OSS_REGION = "oss-ap-southeast-1";
const OSS_HOST = `${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`;

// Buffer appended to `deadline` so evaluators still have a grace window
// after the nominal deadline passes (e.g. late submissions, review).
const DEADLINE_BUFFER_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MIN_EXPIRY_SECONDS = 60 * 60;               // never sign for less than 1h
// Aliyun caps signed-URL expiry; keep a safe ceiling.
const MAX_EXPIRY_SECONDS = 365 * 24 * 60 * 60;    // 1 year

/**
 * V1 query-string signing — mirrors src/lib/oss.ts:generateSignedUrl
 * but takes an explicit absolute `expires` epoch second so callers
 * can pin the expiry to a business deadline rather than "now + 1h".
 */
function signObjectKey(
  objectKey: string,
  expiresEpochSec: number,
  accessKeyId: string,
  accessKeySecret: string,
): string {
  const canonicalResource = `/${OSS_BUCKET}/${objectKey}`;
  const stringToSign = `GET\n\n\n${expiresEpochSec}\n${canonicalResource}`;
  const signature = createHmac("sha1", accessKeySecret)
    .update(stringToSign)
    .digest("base64");
  const params = new URLSearchParams({
    OSSAccessKeyId: accessKeyId,
    Expires: String(expiresEpochSec),
    Signature: signature,
  });
  return `https://${OSS_HOST}/${objectKey}?${params.toString()}`;
}

/**
 * Sign an OSS object key with an absolute expiry.
 * Throws if credentials are missing — caller must handle (no silent fallback
 * here because this is only invoked during admin-initiated Dataset creation,
 * where we want loud failure, not a half-configured system).
 */
export function signUrlWithExpiry(
  ossKey: string,
  expiresAt: Date,
): string {
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("ALIYUN_OSS_ACCESS_KEY_ID / SECRET not configured");
  }
  const expiresEpochSec = Math.floor(expiresAt.getTime() / 1000);
  return signObjectKey(ossKey, expiresEpochSec, accessKeyId, accessKeySecret);
}

/**
 * Compute the signed-URL expiry date for a given package deadline.
 *   expiry = deadline + 7d  (clamped to [now+1h, now+1y])
 * If deadline is null (package has no deadline yet) use now + 1y.
 */
export function computeExpiryDate(deadline: Date | null): Date {
  const now = Date.now();
  const target = deadline
    ? deadline.getTime() + DEADLINE_BUFFER_SECONDS * 1000
    : now + MAX_EXPIRY_SECONDS * 1000;
  const minTs = now + MIN_EXPIRY_SECONDS * 1000;
  const maxTs = now + MAX_EXPIRY_SECONDS * 1000;
  const clamped = Math.min(Math.max(target, minTs), maxTs);
  return new Date(clamped);
}

export interface RefreshResult {
  videoAssetsRefreshed: number;
  imagesRefreshed: number;
  videoAssetsSkipped: number;
  imagesSkipped: number;
}

/**
 * Re-sign every VideoAsset and Image reachable from `packageId` whose
 * current `expiresAt` is earlier than the new target expiry.
 *
 * Semantics (matches the plan — user confirmed 2026-04-17):
 *   - Extending deadline    → refresh rows with expiresAt < newExpiry
 *   - Shortening deadline   → no-op (already-signed URLs remain valid, which
 *                             is fine; evaluators keep access until original
 *                             expiry). Caller shouldn't invoke this path, but
 *                             the skip-if-newer logic makes it safe anyway.
 *
 * Reachability:
 *   - Legacy: VideoAsset.packageId == packageId (pre-Dataset era)
 *   - New:    VideoAsset.datasetId ∈ package.datasets (many-to-many)
 *   - Images: Image.imageSet ∈ {dataset.imageSet for dataset in package.datasets}
 */
export async function refreshSignedUrlsForPackage(
  packageId: string,
  newDeadline: Date | null,
): Promise<RefreshResult> {
  const newExpiry = computeExpiryDate(newDeadline);

  // Collect reachable VideoAssets: union of legacy `packageId` and new `Dataset` path.
  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: {
      datasets: {
        select: {
          id: true,
          imageSetId: true,
        },
      },
    },
  });
  if (!pkg) {
    throw new Error(`Package not found: ${packageId}`);
  }
  const datasetIds = pkg.datasets.map((d) => d.id);
  const imageSetIds = pkg.datasets
    .map((d) => d.imageSetId)
    .filter((x): x is string => Boolean(x));

  const videoAssets = await prisma.videoAsset.findMany({
    where: {
      OR: [
        { packageId },
        ...(datasetIds.length > 0 ? [{ datasetId: { in: datasetIds } }] : []),
      ],
      ossKey: { not: null },
    },
    select: { id: true, ossKey: true, expiresAt: true },
  });

  const images = imageSetIds.length > 0
    ? await prisma.image.findMany({
        where: { imageSetId: { in: imageSetIds } },
        select: { id: true, ossKey: true, expiresAt: true },
      })
    : [];

  let videoAssetsRefreshed = 0;
  let videoAssetsSkipped = 0;
  for (const va of videoAssets) {
    if (!va.ossKey) {
      videoAssetsSkipped++;
      continue;
    }
    // Skip if existing expiry already covers the new window.
    if (va.expiresAt && va.expiresAt.getTime() >= newExpiry.getTime()) {
      videoAssetsSkipped++;
      continue;
    }
    const signedUrl = signUrlWithExpiry(va.ossKey, newExpiry);
    await prisma.videoAsset.update({
      where: { id: va.id },
      data: { signedUrl, url: signedUrl, expiresAt: newExpiry },
    });
    videoAssetsRefreshed++;
  }

  let imagesRefreshed = 0;
  let imagesSkipped = 0;
  for (const img of images) {
    if (!img.ossKey) {
      imagesSkipped++;
      continue;
    }
    if (img.expiresAt && img.expiresAt.getTime() >= newExpiry.getTime()) {
      imagesSkipped++;
      continue;
    }
    const signedUrl = signUrlWithExpiry(img.ossKey, newExpiry);
    await prisma.image.update({
      where: { id: img.id },
      data: { signedUrl, expiresAt: newExpiry },
    });
    imagesRefreshed++;
  }

  return { videoAssetsRefreshed, imagesRefreshed, videoAssetsSkipped, imagesSkipped };
}

/**
 * Sign a fresh batch of VideoAssets and Images at Dataset-creation time.
 * The admin passes in the package's deadline (nullable), and this helper
 * signs every row so workstation queries can serve them without hitting OSS.
 */
export async function signDatasetAssets(params: {
  videoAssets: { id: string; ossKey: string }[];
  images?: { id: string; ossKey: string }[];
  deadline: Date | null;
}): Promise<{ expiresAt: Date; videoSigned: number; imageSigned: number }> {
  const expiresAt = computeExpiryDate(params.deadline);

  for (const va of params.videoAssets) {
    const signedUrl = signUrlWithExpiry(va.ossKey, expiresAt);
    await prisma.videoAsset.update({
      where: { id: va.id },
      data: { signedUrl, url: signedUrl, expiresAt },
    });
  }

  const images = params.images ?? [];
  for (const img of images) {
    const signedUrl = signUrlWithExpiry(img.ossKey, expiresAt);
    await prisma.image.update({
      where: { id: img.id },
      data: { signedUrl, expiresAt },
    });
  }

  return {
    expiresAt,
    videoSigned: params.videoAssets.length,
    imageSigned: images.length,
  };
}
