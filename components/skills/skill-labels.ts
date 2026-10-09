import type { MasteryState } from "@/lib/learning/mastery";

export const STATE_TONE: Record<MasteryState, "neutral" | "info" | "success" | "warning"> = {
  new: "neutral",
  learning: "info",
  developing: "info",
  strong: "success",
  mastered: "success",
  rusty: "warning",
};

export const DIMENSION_NAMES: Record<string, string> = {
  concept: "Concept",
  recognition: "Recognition",
  implementation: "Coding",
  complexity: "Complexity",
  explanation: "Explanation",
  testing: "Testing",
  communication: "Communication",
  design: "Design",
};

export const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export function formatDate(iso: string | null): string {
  return iso === null ? "—" : dateFormat.format(new Date(iso));
}
