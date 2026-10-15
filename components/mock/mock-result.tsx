import type { DimensionStatus, MockResult } from "@/lib/interview/mock-scoring";
import { Badge, Card } from "@/components/ui";

const STATUS: Record<DimensionStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  strong: { label: "Strong", tone: "success" },
  partial: { label: "Partly shown", tone: "warning" },
  weak: { label: "Not shown yet", tone: "danger" },
  not_assessed: { label: "Not assessed", tone: "neutral" },
};

export const OVERALL: Record<MockResult["overall"], string> = {
  strong: "Strong practice performance",
  mixed: "Mixed: some strengths, some gaps",
  needs_work: "Needs more practice",
};

export function MockResultView({ result, problemTitle }: { result: MockResult; problemTitle: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-lg font-semibold">{OVERALL[result.overall]}</h2>
        <p className="mt-1 text-sm">
          {problemTitle}: {result.solved ? "solved" : "not solved"} · {result.submissions} submission{result.submissions === 1 ? "" : "s"} · {result.minutesUsed} min
        </p>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{result.disclaimer}</p>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Evidence</h2>
        <ul className="flex flex-col gap-3">
          {result.dimensions.map((dimension) => (
            <li key={dimension.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{dimension.name}</span>
                <Badge tone={STATUS[dimension.status].tone}>{STATUS[dimension.status].label}</Badge>
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">{dimension.evidence}</p>
            </li>
          ))}
        </ul>
      </Card>
      {result.nextActions.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Next</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {result.nextActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
