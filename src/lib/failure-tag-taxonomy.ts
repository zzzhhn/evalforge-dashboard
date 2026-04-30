// MECE failure-tag taxonomy for the v2 I2V/T2V evaluation workflow.
// Each L1 dimension gets ~3 dimension-specific tags plus the two universal
// tags (prompt 不遵循 / 结果不可用) that apply to every dimension.
//
// Design principle: tags within a D1 bucket must be mutually exclusive
// AND collectively exhaustive. "完全偏离" → universal "prompt 不遵循".
// "整段废掉" → universal "结果不可用". Everything in between collapses
// into the dimension-specific set.
//
// The L1 code is matched against the prefix of the dimension `code`
// field in DB (e.g. "D1", "D10", "D15"). Match is exact — "D1" does NOT
// match "D10" because the prefix parser anchors at the start and stops
// before the digit boundary.

export interface FailureTagSpec {
  labelZh: string;
  labelEn: string;
}

// Universal tags — attached to every L1 dimension. Naming kept short
// so they render cleanly in the workstation pill row.
export const UNIVERSAL_FAILURE_TAGS: readonly FailureTagSpec[] = [
  { labelZh: "prompt 不遵循", labelEn: "Ignores prompt" },
  { labelZh: "结果不可用", labelEn: "Unusable output" },
] as const;

// L1-specific taxonomy. Covers the full 15-bucket I2V/T2V D1–D15 tree
// observed in Evaluation-Friday/T2V_I2V_200_new.xlsx (2026-04-22).
export const L1_FAILURE_TAGS: Record<string, readonly FailureTagSpec[]> = {
  D1: [
    { labelZh: "要求元素缺失", labelEn: "Missing required element" },
    { labelZh: "动作顺序错误", labelEn: "Wrong action order" },
    { labelZh: "约束条件未满足", labelEn: "Constraint not satisfied" },
  ],
  D2: [
    { labelZh: "解剖/结构扭曲", labelEn: "Anatomical distortion" },
    { labelZh: "物体边界撕裂", labelEn: "Boundary tearing" },
    { labelZh: "数量/肢体异常", labelEn: "Extra/missing limbs" },
  ],
  D3: [
    { labelZh: "画面闪烁抖动", labelEn: "Flicker / jitter" },
    { labelZh: "主体身份漂移", labelEn: "Identity drift" },
    { labelZh: "帧间运动跳变", labelEn: "Frame-to-frame jump" },
  ],
  D4: [
    { labelZh: "外形特征漂移", labelEn: "Feature drift" },
    { labelZh: "服饰/饰物变化", labelEn: "Outfit inconsistency" },
    { labelZh: "表情/神态不一致", labelEn: "Expression inconsistency" },
  ],
  D5: [
    { labelZh: "材质仿真失败", labelEn: "Material looks fake" },
    { labelZh: "细节模糊丢失", labelEn: "Detail loss / blur" },
    { labelZh: "反光/阴影不合理", labelEn: "Unrealistic shading" },
  ],
  D6: [
    { labelZh: "违反重力/惯性", labelEn: "Physics violation" },
    { labelZh: "碰撞穿模", labelEn: "Object clipping" },
    { labelZh: "流体/烟雾异常", labelEn: "Fluid / smoke anomaly" },
  ],
  D7: [
    { labelZh: "动作幅度不足", labelEn: "Motion too subtle" },
    { labelZh: "动作失真僵硬", labelEn: "Stiff / distorted motion" },
    { labelZh: "关键动作未发生", labelEn: "Key action missing" },
  ],
  D8: [
    { labelZh: "运镜方向错误", labelEn: "Wrong camera direction" },
    { labelZh: "运镜幅度不匹配", labelEn: "Camera magnitude mismatch" },
    { labelZh: "镜头语言混乱", labelEn: "Conflated camera moves" },
  ],
  D9: [
    { labelZh: "景别错误", labelEn: "Wrong shot size" },
    { labelZh: "主体偏离/出画", labelEn: "Subject off-frame" },
    { labelZh: "构图失衡", labelEn: "Unbalanced composition" },
  ],
  D10: [
    { labelZh: "光源方向错误", labelEn: "Wrong light direction" },
    { labelZh: "光照强度失真", labelEn: "Intensity mismatch" },
    { labelZh: "阴影/高光丢失", labelEn: "Shadow / highlight loss" },
  ],
  D11: [
    { labelZh: "目标色调未实现", labelEn: "Target grade not applied" },
    { labelZh: "色彩偏饱和/过暗", labelEn: "Over-saturated / muddy" },
    { labelZh: "色彩溢出", labelEn: "Color bleed onto wrong area" },
  ],
  D12: [
    { labelZh: "切镜点错误", labelEn: "Wrong cut point" },
    { labelZh: "叙事断裂", labelEn: "Narrative break" },
    { labelZh: "镜头间色调跳变", labelEn: "Tonal jump between shots" },
  ],
  D13: [
    { labelZh: "人脸细节异常", labelEn: "Face detail artifact" },
    { labelZh: "肢体/服饰不真实", labelEn: "Unnatural body / clothing" },
    { labelZh: "场景过于合成", labelEn: "Plastic / synthetic scene" },
  ],
  D14: [
    { labelZh: "绘画风格不一致", labelEn: "Art style inconsistency" },
    { labelZh: "动漫特征弱化", labelEn: "Lost anime styling" },
    { labelZh: "IP 角色辨识度丢失", labelEn: "IP character unrecognizable" },
  ],
  D15: [
    { labelZh: "创意表现不足", labelEn: "Insufficient creativity" },
    { labelZh: "风格不统一", labelEn: "Style inconsistency" },
    { labelZh: "元素违和", labelEn: "Out-of-place elements" },
  ],
};

/**
 * Extract the canonical L1 prefix from a dimension code. Uses the first
 * alpha+digits run (e.g. "D10.3" → "D10", "D1.7" → "D1"). Returns null
 * if the code doesn't look like our L1.x.y scheme.
 */
export function extractL1Code(dimensionCode: string): string | null {
  const m = dimensionCode.match(/^([A-Za-z]+\d+)/);
  return m ? m[1] : null;
}

/**
 * Build the canonical tag list for a given L1 code. Returns universal
 * tags + L1-specific tags, in render order. Unknown L1 codes fall back
 * to universal-only (safer than silent empty).
 */
export function canonicalTagsForL1(l1Code: string): readonly FailureTagSpec[] {
  const specific = L1_FAILURE_TAGS[l1Code] ?? [];
  return [...specific, ...UNIVERSAL_FAILURE_TAGS];
}
