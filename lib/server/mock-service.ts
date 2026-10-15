import "server-only";
import { z } from "zod";
import { MOCK_DURATIONS, mockPlanSchema, scoreMock, type MockPlan, type MockResult } from "@/lib/interview/mock-scoring";
import type { LearningStore, QuestRecord } from "./learning-store";
import type { MockRecord, MockStore } from "./mock-store";
import { ApiError } from "./http";

/**
 * Mock interviews (spec §33, §34): a timed coding interview on a problem the learner hasn't
 * attempted, with hints refused by the server while it runs. Finishing (or being found past the
 * deadline) scores it once from the recorded submissions; the result never changes afterwards.
 */

/** Campaigns whose problems make fair coding-interview questions. */
export const MOCK_CAMPAIGNS = ["problems.data-structures", "problems.patterns", "practical.workshop"] as const;
const RECENT_MOCKS = 20;

export const startMockSchema = z.object({
  durationMinutes: z.union(MOCK_DURATIONS.map((minutes) => z.literal(minutes)) as [z.ZodLiteral<45>, z.ZodLiteral<60>]),
  requestKey: z.string().min(8).max(80),
});

export interface MockView {
  readonly id: string;
  readonly state: "running" | "finished";
  readonly durationMinutes: number;
  readonly startedAt: string;
  readonly endsAt: string;
  readonly problem: { readonly contentVersionId: string; readonly title: string };
  readonly plan: MockPlan;
  readonly result?: MockResult;
}

export interface MockServiceDeps {
  readonly store: MockStore;
  readonly quests: Pick<LearningStore, "listVisibleQuests" | "getVisibleQuest">;
  readonly clock?: () => Date;
  readonly random?: () => number;
}

export class MockService {
  private readonly store: MockStore;
  private readonly quests: MockServiceDeps["quests"];
  private readonly clock: () => Date;
  private readonly random: () => number;

  constructor(deps: MockServiceDeps) {
    this.store = deps.store;
    this.quests = deps.quests;
    this.clock = deps.clock ?? (() => new Date());
    this.random = deps.random ?? Math.random;
  }

  /** Starts a mock, or returns the one already running (and the original for a repeated request key). */
  async start(userId: string, request: z.infer<typeof startMockSchema>): Promise<MockView> {
    const replay = await this.store.byRequestKey(userId, request.requestKey);
    if (replay) return this.view(userId, replay);
    const running = await this.current(userId);
    if (running) return this.view(userId, running);

    const problem = await this.pickProblem(userId);
    const startedAt = this.clock();
    const inserted = await this.store.insert({
      userId,
      durationMinutes: request.durationMinutes,
      contentVersionId: problem.contentVersionId,
      requestKey: request.requestKey,
      startedAt,
      endsAt: new Date(startedAt.getTime() + request.durationMinutes * 60_000),
    });
    if (inserted !== "conflict") return this.view(userId, inserted, problem);
    // A concurrent start won the race: report whichever mock it created.
    const winner = (await this.store.byRequestKey(userId, request.requestKey)) ?? (await this.store.unfinished(userId));
    if (!winner) throw new ApiError(409, "mock_conflict", "Couldn't start the mock interview; try again.");
    return this.view(userId, winner);
  }

  async get(userId: string, id: string): Promise<MockView> {
    const mock = await this.requireMock(userId, id);
    return this.view(userId, await this.finishIfExpired(userId, mock));
  }

  async savePlan(userId: string, id: string, plan: unknown): Promise<{ saved: true }> {
    const parsed = mockPlanSchema.parse(plan);
    const mock = await this.finishIfExpired(userId, await this.requireMock(userId, id));
    if (mock.finishedAt || !(await this.store.savePlan(userId, id, parsed))) throw new ApiError(409, "mock_finished", "This mock interview has finished; its plan can't change.");
    return { saved: true };
  }

  async finish(userId: string, id: string): Promise<MockView> {
    const mock = await this.requireMock(userId, id);
    return this.view(userId, await this.score(userId, mock, this.clock()));
  }

  async recent(userId: string): Promise<{ running?: MockView; past: MockView[] }> {
    const mocks = await Promise.all((await this.store.recent(userId, RECENT_MOCKS)).map((mock) => this.finishIfExpired(userId, mock)));
    const views = await Promise.all(mocks.map((mock) => this.view(userId, mock)));
    return { running: views.find((view) => view.state === "running"), past: views.filter((view) => view.state === "finished") };
  }

  /** Whether hints for this problem are off because a mock on it is running. */
  async hintsBlocked(userId: string, contentVersionId: string): Promise<boolean> {
    const running = await this.current(userId);
    return running !== undefined && running.contentVersionId === contentVersionId;
  }

  /** The unfinished mock if it's still inside its time; an expired one is scored on the way. */
  private async current(userId: string): Promise<MockRecord | undefined> {
    const unfinished = await this.store.unfinished(userId);
    if (!unfinished) return undefined;
    const settled = await this.finishIfExpired(userId, unfinished);
    return settled.finishedAt ? undefined : settled;
  }

  private async finishIfExpired(userId: string, mock: MockRecord): Promise<MockRecord> {
    if (mock.finishedAt || this.clock().getTime() < mock.endsAt.getTime()) return mock;
    return this.score(userId, mock, mock.endsAt);
  }

  private async score(userId: string, mock: MockRecord, finishedAt: Date): Promise<MockRecord> {
    if (mock.finishedAt) return mock;
    const submissions = await this.store.submissionsFor(userId, mock.contentVersionId, mock.startedAt);
    const result = scoreMock({ plan: mockPlanSchema.parse(mock.plan), startedAt: mock.startedAt, endsAt: mock.endsAt, finishedAt, submissions });
    if (await this.store.finish(userId, mock.id, finishedAt, result)) return { ...mock, finishedAt, result };
    // Finished concurrently (another tab): the stored result stands.
    return (await this.store.get(userId, mock.id)) ?? mock;
  }

  private async pickProblem(userId: string): Promise<QuestRecord> {
    const [quests, attempted] = await Promise.all([this.quests.listVisibleQuests(userId), this.store.attemptedContentIds(userId)]);
    const pool = quests.filter((quest) => (MOCK_CAMPAIGNS as readonly string[]).includes(quest.campaign.id) && !attempted.has(quest.contentId));
    if (pool.length === 0) throw new ApiError(409, "no_unseen_problems", "You've attempted every interview problem available. New problems will make new mocks possible.");
    return pool[Math.floor(this.random() * pool.length)];
  }

  private async requireMock(userId: string, id: string): Promise<MockRecord> {
    const mock = await this.store.get(userId, id);
    if (!mock) throw new ApiError(404, "not_found", "That mock interview doesn't exist.");
    return mock;
  }

  private async view(userId: string, mock: MockRecord, known?: QuestRecord): Promise<MockView> {
    const quest = known ?? (await this.quests.getVisibleQuest(userId, mock.contentVersionId));
    return {
      id: mock.id,
      state: mock.finishedAt ? "finished" : "running",
      durationMinutes: mock.durationMinutes,
      startedAt: mock.startedAt.toISOString(),
      endsAt: mock.endsAt.toISOString(),
      problem: { contentVersionId: mock.contentVersionId, title: quest?.title ?? "A problem no longer available" },
      plan: mockPlanSchema.parse(mock.plan),
      ...(mock.result && { result: mock.result }),
    };
  }
}
