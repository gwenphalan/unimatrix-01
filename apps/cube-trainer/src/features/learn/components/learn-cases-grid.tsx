import { useRef } from "react";

import { useCircuitOccluder } from "@unimatrix/ui/public";

import { getAlgorithmSet, groupCasesByGroup } from "@/features/algorithms/algorithm-sets";
import { CasePreviewCard } from "@/features/algorithms/components/case-preview-card";
import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import type { CaseProgress, CaseStatus } from "@/lib/progress-storage";
import { useCaseProgress } from "@/features/algorithms/use-case-progress";

export interface LearnCasesGridProps {
  setId: AlgorithmSetId;
}

// A hook can't be called per iteration of the outer `.map()`, so each
// group's occluder registration lives in its own component.
function LearnGroupSection({
  cases,
  group,
  progress,
  setId,
  updateStatus,
}: {
  cases: AlgorithmCase[];
  group: string;
  progress: CaseProgress;
  setId: AlgorithmSetId;
  updateStatus: (caseId: string, status: CaseStatus) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  useCircuitOccluder(sectionRef, { enabled: cases.length > 0 });

  if (cases.length === 0) return null;

  return (
    <section className="space-y-3" ref={sectionRef}>
      <h3 className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
        {group}
      </h3>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {cases.map((algorithmCase) => {
          const learned = progress[algorithmCase.id] === "known";

          return (
            <CasePreviewCard
              algorithmCase={algorithmCase}
              dimmed={learned}
              key={algorithmCase.id}
              learned={learned}
              onClick={() => {
                updateStatus(algorithmCase.id, "known");
              }}
              pressed={learned}
              setId={setId}
            />
          );
        })}
      </div>
    </section>
  );
}

export function LearnCasesGrid({ setId }: LearnCasesGridProps) {
  const algorithmSet = getAlgorithmSet(setId);
  const groupedCases = groupCasesByGroup(algorithmSet);
  const { progress, updateStatus } = useCaseProgress(setId);

  return (
    <div className="space-y-8">
      {groupedCases.map(({ cases, group }) => (
        <LearnGroupSection
          cases={cases}
          group={group}
          key={group}
          progress={progress}
          setId={setId}
          updateStatus={updateStatus}
        />
      ))}
    </div>
  );
}
