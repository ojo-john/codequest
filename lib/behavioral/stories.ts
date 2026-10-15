import { z } from "zod";

/**
 * Behavioral interview preparation (spec §35). Stories are the learner's own true experiences;
 * everything here checks structure and coverage only. Nothing generates, rewrites or "improves"
 * story content, and no check rewards numbers that aren't real.
 */

export const COMPETENCIES = [
  { id: "leadership", name: "Leadership" },
  { id: "conflict", name: "Conflict" },
  { id: "failure", name: "Failure and mistakes" },
  { id: "ambiguity", name: "Ambiguity" },
  { id: "ownership", name: "Ownership" },
  { id: "prioritization", name: "Prioritization" },
  { id: "technical-decision", name: "Technical decisions" },
  { id: "influence", name: "Influence without authority" },
  { id: "mentoring", name: "Mentoring" },
  { id: "disagreement", name: "Disagreement" },
  { id: "difficult-project", name: "Difficult projects" },
] as const;

export type CompetencyId = (typeof COMPETENCIES)[number]["id"];
const COMPETENCY_IDS = COMPETENCIES.map((competency) => competency.id) as [CompetencyId, ...CompetencyId[]];

export const MAX_STORIES = 100;
const part = z.string().max(4000);

export const storyInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    competencies: z.array(z.enum(COMPETENCY_IDS)).max(6).transform((ids) => [...new Set(ids)]),
    situation: part,
    task: part,
    action: part,
    result: part,
    learned: part,
  })
  .strict();

export type StoryInput = z.infer<typeof storyInputSchema>;

export interface Story extends StoryInput {
  readonly id: string;
  readonly updatedAt: string;
}

// --------------------------------------------------------------------------------------------
// Structure checks
// --------------------------------------------------------------------------------------------

/** A STAR part counts as written at this many words. */
const MIN_PART_WORDS = 8;
/** Typical speaking pace, for estimating how long the story takes to tell. */
const WORDS_PER_MINUTE = 150;
const MIN_SPOKEN_MINUTES = 1;
const MAX_SPOKEN_MINUTES = 3;
/** "We" this many times more often than "I" in the action hides the learner's own part. */
const WE_TO_I_LIMIT = 2;

export type CheckStatus = "ok" | "suggestion";

export interface StoryCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly message: string;
}

const words = (text: string): string[] => text.split(/\s+/).filter((word) => word.length > 0);
const countWord = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

export function spokenMinutes(story: Pick<StoryInput, "situation" | "task" | "action" | "result" | "learned">): number {
  const total = [story.situation, story.task, story.action, story.result, story.learned].reduce((sum, text) => sum + words(text).length, 0);
  return Math.round((total / WORDS_PER_MINUTE) * 10) / 10;
}

export function checkStory(story: StoryInput): StoryCheck[] {
  const checks: StoryCheck[] = [];
  const parts = [
    ["situation", "Situation", "Set the scene in a sentence or two: where you were and what was at stake."],
    ["task", "Task", "Say what you were responsible for, specifically."],
    ["action", "Action", "Describe the steps you took. This is the heart of the answer."],
    ["result", "Result", "Say how it turned out, including if it went badly."],
  ] as const;
  for (const [id, name, prompt] of parts) {
    const written = words(story[id]).length >= MIN_PART_WORDS;
    checks.push({ id, status: written ? "ok" : "suggestion", message: written ? `${name} is there.` : `${name}: ${prompt}` });
  }

  const singular = countWord(story.action, /\b(I|I'm|I've|I'd|me|my|myself)\b/g);
  const plural = countWord(story.action, /\b(we|we're|we've|us|our|ourselves)\b/gi);
  const ownRole = plural <= Math.max(1, singular) * WE_TO_I_LIMIT;
  checks.push({
    id: "own-role",
    status: ownRole ? "ok" : "suggestion",
    message: ownRole ? "Your own part in the action is clear." : `The action says "we" ${plural} times and "I" ${singular}. Interviewers want your part: what did you do?`,
  });

  const minutes = spokenMinutes(story);
  const length = minutes < MIN_SPOKEN_MINUTES ? "short" : minutes > MAX_SPOKEN_MINUTES ? "long" : "ok";
  checks.push({
    id: "length",
    status: length === "ok" ? "ok" : "suggestion",
    message:
      length === "ok"
        ? `About ${minutes} minutes to tell: a good length.`
        : length === "short"
          ? `About ${minutes} minutes to tell. Most strong answers take 1 to 3 minutes; add the detail that shows your judgement.`
          : `About ${minutes} minutes to tell. Aim for 1 to 3: trim the situation and keep the action.`,
  });

  const measured = /\d/.test(story.result);
  checks.push({
    id: "evidence",
    status: "ok",
    message: measured
      ? "The result includes a measure. Make sure you can explain where the number came from."
      : "If you know a real, measured outcome, add it. Never estimate or invent a number to sound stronger.",
  });

  const reflected = words(story.learned).length >= MIN_PART_WORDS;
  checks.push({
    id: "learned",
    status: reflected ? "ok" : "suggestion",
    message: reflected ? "You say what you learned." : "Add what you learned or would do differently: interviewers often ask.",
  });

  if (story.competencies.length === 0) checks.push({ id: "tags", status: "suggestion", message: "Tag the competencies this story shows, so you can find it for the right question." });
  return checks;
}

// --------------------------------------------------------------------------------------------
// Coverage and the question bank
// --------------------------------------------------------------------------------------------

export function coverage(stories: ReadonlyArray<Pick<Story, "id" | "title" | "competencies">>): Array<{ id: CompetencyId; name: string; stories: Array<{ id: string; title: string }> }> {
  return COMPETENCIES.map((competency) => ({
    id: competency.id,
    name: competency.name,
    stories: stories.filter((story) => story.competencies.includes(competency.id)).map((story) => ({ id: story.id, title: story.title })),
  }));
}

export const QUESTIONS: ReadonlyArray<{ readonly prompt: string; readonly competencies: readonly CompetencyId[] }> = [
  { prompt: "Tell me about a time you led a project or a group without being asked to.", competencies: ["leadership", "ownership"] },
  { prompt: "Tell me about a conflict with a teammate and how you handled it.", competencies: ["conflict"] },
  { prompt: "Tell me about a mistake you made. What happened next?", competencies: ["failure", "ownership"] },
  { prompt: "Tell me about a time you failed to meet a goal.", competencies: ["failure"] },
  { prompt: "Describe a time the requirements were unclear. How did you move forward?", competencies: ["ambiguity"] },
  { prompt: "Tell me about something you owned from start to finish.", competencies: ["ownership"] },
  { prompt: "Tell me about a time you had too much to do. How did you decide what came first?", competencies: ["prioritization"] },
  { prompt: "Tell me about a technical decision you made and the trade-offs you weighed.", competencies: ["technical-decision"] },
  { prompt: "Tell me about a time you changed someone's mind without authority over them.", competencies: ["influence"] },
  { prompt: "Tell me about a time you helped someone grow.", competencies: ["mentoring"] },
  { prompt: "Tell me about a time you disagreed with your manager or a senior engineer.", competencies: ["disagreement", "conflict"] },
  { prompt: "Tell me about the hardest project you've worked on.", competencies: ["difficult-project"] },
  { prompt: "Tell me about a time you had to deliver under a tight deadline.", competencies: ["prioritization", "difficult-project"] },
  { prompt: "Tell me about a time you received critical feedback.", competencies: ["failure", "mentoring"] },
];
