/**
 * Asset URL signing utility.
 *
 * In the production Video Rebirth platform, this module generates
 * Aliyun OSS pre-signed URLs for private video assets.
 *
 * For this personal EvalForge deployment, videos use public URLs
 * so signing is a no-op pass-through.
 */
export function signOssUrl(publicUrl: string): string {
  return publicUrl;
}

export function signAssetUrls(
  videoUrl: string,
  sourceImage: string | null
): { videoUrl: string; sourceImage: string | null } {
  return {
    videoUrl: signOssUrl(videoUrl),
    sourceImage: sourceImage ? signOssUrl(sourceImage) : null,
  };
}
