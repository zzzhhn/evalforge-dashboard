import { createHmac } from "crypto";

const OSS_BUCKET = process.env.OSS_BUCKET_NAME ?? "evalforge-demo-bucket";
const OSS_REGION = "oss-ap-southeast-1";
const OSS_HOST = `${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`;

/**
 * Aliyun OSS V1 header signature for server-to-server API calls.
 *
 * StringToSign = VERB + "\n"
 *              + Content-MD5 + "\n"
 *              + Content-Type + "\n"
 *              + Date + "\n"
 *              + CanonicalizedOSSHeaders
 *              + CanonicalizedResource
 */
function signHeaderV1(
  method: "GET" | "PUT" | "DELETE" | "HEAD",
  canonicalizedResource: string,
  accessKeyId: string,
  accessKeySecret: string,
): { date: string; authorization: string } {
  const date = new Date().toUTCString();
  const stringToSign = `${method}\n\n\n${date}\n${canonicalizedResource}`;
  const signature = createHmac("sha1", accessKeySecret)
    .update(stringToSign)
    .digest("base64");
  return {
    date,
    authorization: `OSS ${accessKeyId}:${signature}`,
  };
}

export interface OssObject {
  key: string;
  size: number;
  lastModified: string;
}

/**
 * List all objects under a prefix via OSS ListObjectsV2 (with pagination).
 * Returns every matching object key across paginated responses.
 */
/**
 * Strip optional `oss://bucket/` (or `oss://bucket-name.endpoint/`) URL prefix
 * from a user-pasted path, returning only the object-key prefix portion.
 *
 * Aliyun's own Console produces `oss://bucket/key` style paths, so users paste
 * them verbatim. We keep support for plain keys (no scheme) as well.
 */
export function normalizeOssPrefix(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+/, "");
  const match = trimmed.match(/^oss:\/\/([^/]+)\/(.*)$/i);
  if (!match) return trimmed;
  const [, bucket, rest] = match;
  if (bucket !== OSS_BUCKET && !bucket.startsWith(`${OSS_BUCKET}.`)) {
    // Hard-fail loudly so the admin sees a clear error instead of silently
    // listing nothing — much easier to diagnose than "matched: 0" mystery.
    throw new Error(
      `OSS 路径 bucket 不匹配: 期望 "${OSS_BUCKET}",实际 "${bucket}"`,
    );
  }
  return rest;
}

export async function listOssObjects(prefix: string): Promise<OssObject[]> {
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("ALIYUN_OSS_ACCESS_KEY_ID / SECRET not configured");
  }

  const normalizedPrefix = normalizeOssPrefix(prefix);
  const results: OssObject[] = [];
  let continuationToken: string | undefined;

  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({
      "list-type": "2",
      prefix: normalizedPrefix,
      "max-keys": "1000",
    });
    if (continuationToken) params.set("continuation-token", continuationToken);

    // Aliyun V1 signing: only a fixed set of sub-resources participate in the
    // CanonicalizedResource. `list-type` is NOT on that list, so including it
    // here yields SignatureDoesNotMatch. Bucket-only resource is correct for
    // plain ListObjects/ListObjectsV2 calls.
    const canonicalizedResource = `/${OSS_BUCKET}/`;
    const { date, authorization } = signHeaderV1(
      "GET",
      canonicalizedResource,
      accessKeyId,
      accessKeySecret,
    );

    const url = `https://${OSS_HOST}/?${params.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Date: date, Authorization: authorization },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OSS list failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const xml = await res.text();
    const pageObjects = parseListXml(xml);
    results.push(...pageObjects.contents);

    if (!pageObjects.isTruncated || !pageObjects.nextContinuationToken) break;
    continuationToken = pageObjects.nextContinuationToken;
  }

  return results;
}

function parseListXml(xml: string): {
  contents: OssObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
} {
  const contents: OssObject[] = [];
  const contentRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = contentRegex.exec(xml)) !== null) {
    const block = m[1];
    const key = extractTag(block, "Key");
    const size = Number.parseInt(extractTag(block, "Size") ?? "0", 10);
    const lastModified = extractTag(block, "LastModified") ?? "";
    if (key) contents.push({ key, size, lastModified });
  }
  const isTruncated = extractTag(xml, "IsTruncated") === "true";
  const nextContinuationToken = extractTag(xml, "NextContinuationToken") ?? undefined;
  return { contents, isTruncated, nextContinuationToken };
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

export interface MatchResult {
  matched: Map<string, string>;            // externalId → single ossKey
  unmatched: string[];                     // externalIds with no file found
  multiMatched: Map<string, string[]>;     // externalIds with >1 matches → all conflict keys
  unclaimed: string[];                     // ossKeys that matched no externalId
}

/**
 * Match a list of externalIds against objects under an OSS prefix.
 * Rule: fileBasename contains the externalId as substring.
 *
 * Behavior:
 *   - If an externalId matches exactly one file → matched
 *   - If zero files → unmatched
 *   - If >1 files → multiMatched (surface to admin)
 *   - Files that match no externalId → unclaimed (informational)
 */
export async function scanOssForMatches(
  prefix: string,
  externalIds: string[],
): Promise<MatchResult> {
  const objects = await listOssObjects(prefix);
  // Only consider files (not directory markers)
  const files = objects.filter((o) => o.size > 0 && !o.key.endsWith("/"));

  const matched = new Map<string, string>();
  const multiMatched = new Map<string, string[]>();
  const unmatched: string[] = [];
  const claimedKeys = new Set<string>();

  for (const extId of externalIds) {
    const hits = files.filter((f) => basenameOf(f.key).includes(extId));
    if (hits.length === 0) {
      unmatched.push(extId);
    } else if (hits.length === 1) {
      matched.set(extId, hits[0].key);
      claimedKeys.add(hits[0].key);
    } else {
      multiMatched.set(
        extId,
        hits.map((h) => h.key),
      );
      for (const h of hits) claimedKeys.add(h.key);
    }
  }

  const unclaimed = files.map((f) => f.key).filter((k) => !claimedKeys.has(k));

  return { matched, unmatched, multiMatched, unclaimed };
}

function basenameOf(ossKey: string): string {
  const i = ossKey.lastIndexOf("/");
  return i >= 0 ? ossKey.slice(i + 1) : ossKey;
}
