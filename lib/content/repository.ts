import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SourceFile } from "@/lib/execution/source-files";
import type { Mutant } from "@/lib/execution/test-quality";
import { exerciseSetManifestSchema, exerciseSetPrivateSchema, type ExerciseSetManifest, type ExerciseSetPrivate } from "@/lib/exercises/schema";
import {
  questManifestSchema,
  questPrivateSchema,
  skillsFileSchema,
  type QuestManifest,
  type QuestPrivate,
  type SkillsFile,
} from "./schema";

/**
 * Reads the curriculum from the repository. Parsing failures are collected per item (one bad
 * item must not hide problems in the others) and reported by the content gate.
 */

export interface LoadedQuest {
  readonly manifest: QuestManifest;
  readonly instructions: string;
  readonly starter: readonly SourceFile[];
  readonly privateData: QuestPrivate;
  readonly reference: readonly SourceFile[];
  /** Present when private.json declares testQuality. */
  readonly testQuality?: LoadedTestQuality;
}

export interface LoadedTestQuality {
  readonly target: string;
  readonly passRatio: number;
  readonly mutants: readonly Mutant[];
  readonly referenceTests: readonly SourceFile[];
}

export interface LoadedExerciseSet {
  readonly manifest: ExerciseSetManifest;
  readonly privateData: ExerciseSetPrivate;
}

export interface ContentLoadIssue {
  readonly item: string;
  readonly message: string;
}

export interface LoadedContent {
  readonly skills: SkillsFile | undefined;
  readonly quests: readonly LoadedQuest[];
  readonly exerciseSets: readonly LoadedExerciseSet[];
  readonly issues: readonly ContentLoadIssue[];
  /** Raw text of every public file, for leak detection. */
  readonly publicFiles: ReadonlyMap<string, string>;
}

function readTree(root: string): SourceFile[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = join(entry.parentPath, entry.name);
      return { path: relative(root, absolute).split("\\").join("/"), content: readFileSync(absolute, "utf8") };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    return issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function loadContent(contentRoot: string): LoadedContent {
  const issues: ContentLoadIssue[] = [];
  const publicFiles = new Map<string, string>();

  let skills: SkillsFile | undefined;
  try {
    skills = skillsFileSchema.parse(readJson(join(contentRoot, "skills.json")));
  } catch (error) {
    issues.push({ item: "skills.json", message: describe(error) });
  }

  const publicRoot = join(contentRoot, "public");
  const privateRoot = join(contentRoot, "private");
  const quests: LoadedQuest[] = [];
  const exerciseSets: LoadedExerciseSet[] = [];
  const itemDirs = existsSync(publicRoot) ? readdirSync(publicRoot).filter((name) => statSync(join(publicRoot, name)).isDirectory()).sort() : [];

  for (const dir of itemDirs) {
    const itemRoot = join(publicRoot, dir);
    for (const file of readTree(itemRoot)) publicFiles.set(`public/${dir}/${file.path}`, file.content);
    try {
      const raw = readJson(join(itemRoot, "item.json"));
      const privateDir = join(privateRoot, dir);
      if (!existsSync(join(privateDir, "private.json"))) throw new Error(`missing content/private/${dir}/private.json`);
      if ((raw as { kind?: unknown }).kind === "exercise-set") {
        const manifest = exerciseSetManifestSchema.parse(raw);
        if (manifest.id !== dir) throw new Error(`directory name ${dir} must equal id ${manifest.id}`);
        exerciseSets.push({ manifest, privateData: exerciseSetPrivateSchema.parse(readJson(join(privateDir, "private.json"))) });
        continue;
      }
      const manifest = questManifestSchema.parse(raw);
      if (manifest.id !== dir) throw new Error(`directory name ${dir} must equal id ${manifest.id}`);
      const privateData = questPrivateSchema.parse(readJson(join(privateDir, "private.json")));
      quests.push({
        manifest,
        instructions: readFileSync(join(itemRoot, manifest.instructions), "utf8"),
        starter: readTree(join(itemRoot, manifest.starterDir)),
        privateData,
        reference: readTree(join(privateDir, privateData.referenceDir)),
        ...(privateData.testQuality && {
          testQuality: {
            target: privateData.testQuality.target,
            passRatio: privateData.testQuality.passRatio,
            mutants: privateData.testQuality.mutants.map((mutant) => ({
              id: mutant.id,
              description: mutant.description,
              content: readFileSync(join(privateDir, mutant.file), "utf8"),
            })),
            referenceTests: readTree(join(privateDir, privateData.testQuality.referenceTestsDir)),
          },
        }),
      });
    } catch (error) {
      issues.push({ item: dir, message: describe(error) });
    }
  }

  // Private material without a public item is an orphan (likely a renamed item).
  if (existsSync(privateRoot)) {
    for (const dir of readdirSync(privateRoot)) {
      if (!itemDirs.includes(dir)) issues.push({ item: dir, message: "private content has no matching public item" });
    }
  }

  return { skills, quests, exerciseSets, issues, publicFiles };
}
