import { createHmac } from "crypto";

const OSS_BUCKET = process.env.OSS_BUCKET_NAME ?? "evalforge-demo-bucket";
const OSS_REGION = "oss-ap-southeast-1";
const EXPIRY_SECONDS = 3600; // 1 hour

/**
 * Generate an Aliyun OSS pre-signed URL using V1 query-string signature.
 *
 * Signature = Base64(HMAC-SHA1(AccessKeySecret, StringToSign))
 * StringToSign = VERB + "\n" + "\n" + "\n" + Expires + "\n" + CanonicalizedResource
 * CanonicalizedResource = /{bucket}/{objectKey}
 *
 * @see https://help.aliyun.com/zh/oss/developer-reference/include-a-signature-in-a-url
 */
function generateSignedUrl(
  objectKey: string,
  accessKeyId: string,
  accessKeySecret: string
): string {
  const expires = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;
  const canonicalResource = `/${OSS_BUCKET}/${objectKey}`;
  const stringToSign = `GET\n\n\n${expires}\n${canonicalResource}`;

  const signature = createHmac("sha1", accessKeySecret)
    .update(stringToSign)
    .digest("base64");

  const params = new URLSearchParams({
    OSSAccessKeyId: accessKeyId,
    Expires: String(expires),
    Signature: signature,
  });

  return `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com/${objectKey}?${params.toString()}`;
}

/**
 * Convert a public OSS URL to a pre-signed URL.
 * Falls back to the original URL if credentials are not configured.
 */
export function signOssUrl(publicUrl: string): string {
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) return publicUrl;

  try {
    const urlObj = new URL(publicUrl);
    // Validate hostname belongs to our OSS bucket
    const expectedHost = `${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`;
    if (urlObj.hostname !== expectedHost) {
      console.error(`[OSS] Untrusted hostname: ${urlObj.hostname}`);
      return publicUrl;
    }
    const objectKey = urlObj.pathname.slice(1); // remove leading /
    if (!objectKey || objectKey.includes("..")) {
      console.error(`[OSS] Invalid object key: ${objectKey}`);
      return publicUrl;
    }
    return generateSignedUrl(objectKey, accessKeyId, accessKeySecret);
  } catch {
    return publicUrl;
  }
}

/**
 * Sign video URL and optionally source image URL.
 */
export function signAssetUrls(
  videoUrl: string,
  sourceImage: string | null
): { videoUrl: string; sourceImage: string | null } {
  return {
    videoUrl: signOssUrl(videoUrl),
    sourceImage: sourceImage ? signOssUrl(sourceImage) : null,
  };
}
