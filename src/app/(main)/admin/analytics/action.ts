"use server";

import { getSession } from "@/lib/auth";
import { calculateAggregations, type AggregationResult } from "@/lib/aggregation";

export async function triggerCalculation(): Promise<{
  success: boolean;
  error?: string;
  result?: AggregationResult;
}> {
  const session = await getSession();
  if (!session || !["ADMIN", "RESEARCHER"].includes(session.role)) {
    return { success: false, error: "Unauthorized" };
  }

  const result = await calculateAggregations();
  return { success: true, result };
}
