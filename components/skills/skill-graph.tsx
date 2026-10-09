import { layoutSkillGraph } from "@/lib/learning/skill-graph-layout";
import type { WorldView } from "@/lib/learning/skill-tree";

const NODE_WIDTH = 170;
const NODE_HEIGHT = 40;
const COLUMN_GAP = 70;
const ROW_GAP = 22;

/**
 * Visual skill graph (spec §39). The list view above it is the complete accessible view; here
 * each node is still a keyboard-focusable link with its name, inside a group labelled with a
 * text summary (role="img" would hide the links: axe nested-interactive).
 */
export function SkillGraph({ worlds }: { worlds: readonly WorldView[] }) {
  const skills = worlds.flatMap((world) => world.skills.map((skill) => ({ ...skill, worldNumber: world.number })));
  const edges = skills.flatMap((skill) => skill.prerequisites.map((prerequisite) => ({ skillId: skill.id, prerequisiteId: prerequisite.id, kind: prerequisite.kind })));
  const nodes = layoutSkillGraph({ skills, edges });
  const position = new Map(nodes.map((node) => [node.id, { x: node.column * (NODE_WIDTH + COLUMN_GAP), y: node.row * (NODE_HEIGHT + ROW_GAP) }]));
  const width = Math.max(...nodes.map((node) => node.column), 0) * (NODE_WIDTH + COLUMN_GAP) + NODE_WIDTH + 2;
  const height = Math.max(...nodes.map((node) => node.row), 0) * (NODE_HEIGHT + ROW_GAP) + NODE_HEIGHT + 2;
  const started = new Set(skills.filter((skill) => skill.dimensions.length > 0).map((skill) => skill.id));
  const name = new Map(skills.map((skill) => [skill.id, skill.name]));

  return (
    <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Skill graph">
      <svg width={width} height={height} viewBox={`-1 -1 ${width} ${height}`} role="group" aria-labelledby="skill-graph-summary" className="text-neutral-700 dark:text-neutral-300">
        <title id="skill-graph-summary">{`Skill graph: ${skills.length} skills, ${started.size} with evidence. The list view has the same information.`}</title>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = position.get(edge.prerequisiteId);
          const to = position.get(edge.skillId);
          if (!from || !to) return null;
          return (
            <line
              key={`${edge.prerequisiteId}->${edge.skillId}`}
              x1={from.x + NODE_WIDTH}
              y1={from.y + NODE_HEIGHT / 2}
              x2={to.x}
              y2={to.y + NODE_HEIGHT / 2}
              stroke="currentColor"
              strokeWidth={1.2}
              strokeDasharray={edge.kind === "recommended" ? "4 3" : undefined}
              markerEnd="url(#arrow)"
            />
          );
        })}
        {nodes.map((node) => {
          const at = position.get(node.id)!;
          return (
            <a key={node.id} href={`/skills/${node.id}`} aria-label={`${name.get(node.id)}${started.has(node.id) ? ", has evidence" : ", not started"}`}>
              <rect
                x={at.x}
                y={at.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                className={started.has(node.id) ? "fill-indigo-50 stroke-indigo-500 dark:fill-indigo-950" : "fill-white stroke-neutral-400 dark:fill-neutral-900"}
              />
              <text x={at.x + NODE_WIDTH / 2} y={at.y + NODE_HEIGHT / 2 + 4} textAnchor="middle" fontSize={12} fill="currentColor">
                {name.get(node.id)}
              </text>
            </a>
          );
        })}
      </svg>
    </div>
  );
}
