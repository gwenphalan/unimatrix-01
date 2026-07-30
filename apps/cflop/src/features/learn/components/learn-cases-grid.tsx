import { getAlgorithmSet, groupCasesByGroup } from "@/features/algorithms/algorithm-sets";
import { CasePreviewCard } from "@/features/algorithms/components/case-preview-card";
import type { AlgorithmCase, AlgorithmSetId } from "@/features/algorithms/types";
import type { CaseProgress } from "@/lib/progress-storage";
import { useCaseProgress } from "@/features/algorithms/use-case-progress";

export interface LearnCasesGridProps {
  /** Called with the picked case; the set view uses it to open the session on that case. */
  onSelectCase: (algorithmCase: AlgorithmCase) => void;
  setId: AlgorithmSetId;
}

// Kept as its own component for the `useCaseProgress`-driven props below.
function LearnGroupSection({
  cases,
  group,
  onSelectCase,
  progress,
  setId,
}: {
  cases: AlgorithmCase[];
  group: string;
  onSelectCase: (algorithmCase: AlgorithmCase) => void;
  progress: CaseProgress;
  setId: AlgorithmSetId;
}) {
  if (cases.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
        {group}
      </h2>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {cases.map((algorithmCase) => (
          <CasePreviewCard
            algorithmCase={algorithmCase}
            key={algorithmCase.id}
            learned={progress[algorithmCase.id] === "known"}
            onClick={() => {
              onSelectCase(algorithmCase);
            }}
            setId={setId}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * The way back to a learned case's algorithm. A card opens the case in the Learn session
 * rather than marking it learned - marking is what the session's Space key is for, and using
 * the same click for both is what left a learned case with no way to be read again.
 *
 * Learned cards are drawn at full strength. They keep the badge and border, but dimming them
 * read as "finished with" on the one screen whose job is looking an already-learned algorithm
 * back up.
 */
export function LearnCasesGrid({ onSelectCase, setId }: LearnCasesGridProps) {
  const algorithmSet = getAlgorithmSet(setId);
  const groupedCases = groupCasesByGroup(algorithmSet);
  const { progress } = useCaseProgress(setId);

  return (
    <div className="space-y-8">
      {groupedCases.map(({ cases, group }) => (
        <LearnGroupSection
          cases={cases}
          group={group}
          key={group}
          onSelectCase={onSelectCase}
          progress={progress}
          setId={setId}
        />
      ))}
    </div>
  );
}
