/**
 * Layered layout for the skill graph (spec §39): a skill's column is the length of its longest
 * chain of strict prerequisites, so every strict arrow points right. Recommended edges are drawn
 * but don't affect layout (they may form cycles; strict edges can't — the database forbids it).
 */

export interface LayoutInput {
  readonly skills: ReadonlyArray<{ id: string; worldNumber: number }>;
  readonly edges: ReadonlyArray<{ skillId: string; prerequisiteId: string; kind: "strict" | "recommended" }>;
}

export interface LayoutNode {
  readonly id: string;
  readonly column: number;
  readonly row: number;
}

export function layoutSkillGraph(input: LayoutInput): LayoutNode[] {
  const ids = new Set(input.skills.map((skill) => skill.id));
  const strict = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (edge.kind !== "strict" || !ids.has(edge.skillId) || !ids.has(edge.prerequisiteId)) continue;
    strict.set(edge.skillId, [...(strict.get(edge.skillId) ?? []), edge.prerequisiteId]);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    // Defensive: a cycle would be a database bug; treat the back edge as absent.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const value = Math.max(-1, ...(strict.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };

  const world = new Map(input.skills.map((skill) => [skill.id, skill.worldNumber]));
  const byColumn = new Map<number, string[]>();
  for (const skill of input.skills) {
    const column = depthOf(skill.id);
    byColumn.set(column, [...(byColumn.get(column) ?? []), skill.id]);
  }
  const nodes: LayoutNode[] = [];
  for (const [column, members] of byColumn) {
    members
      .sort((a, b) => (world.get(a) ?? 0) - (world.get(b) ?? 0) || a.localeCompare(b))
      .forEach((id, row) => nodes.push({ id, column, row }));
  }
  return nodes.sort((a, b) => a.column - b.column || a.row - b.row);
}
