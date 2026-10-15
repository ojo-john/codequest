import { describe, expect, it } from "vitest";
import type { MockPlan, MockResult, MockSubmission } from "@/lib/interview/mock-scoring";
import { ApiError } from "@/lib/server/http";
import type { QuestRecord } from "@/lib/server/learning-store";
import { MockService } from "@/lib/server/mock-service";
import type { MockRecord, MockStore, NewMock } from "@/lib/server/mock-store";

const USER = "11111111-1111-4111-8111-111111111111";
const T0 = new Date("2026-10-15T10:00:00Z");
const minutesAfter = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function quest(contentId: string, campaign: string): QuestRecord {
  return { contentVersionId: `cv-${contentId}`, contentId, title: contentId, campaign: { id: campaign, order: 1 } } as unknown as QuestRecord;
}

const QUESTS = [quest("problems.pair-sum", "problems.patterns"), quest("workshop.lru-cache", "practical.workshop"), quest("cart.q1", "campaign.shopping-cart"), quest("debug.one", "problems.debug-dungeon")];

class FakeMockStore implements MockStore {
  mocks: Array<MockRecord & { requestKey: string }> = [];
  attempted = new Set<string>();
  submissions: MockSubmission[] = [];
  finishCalls = 0;

  async unfinished() { return this.mocks.find((mock) => !mock.finishedAt); }
  async get(_userId: string, id: string) { return this.mocks.find((mock) => mock.id === id); }
  async byRequestKey(_userId: string, key: string) { return this.mocks.find((mock) => mock.requestKey === key); }
  async insert(mock: NewMock) {
    if (this.mocks.some((existing) => existing.requestKey === mock.requestKey || !existing.finishedAt)) return "conflict" as const;
    const record = { id: `mock-${this.mocks.length + 1}`, kind: "coding" as const, durationMinutes: mock.durationMinutes, contentVersionId: mock.contentVersionId, plan: {}, startedAt: mock.startedAt, endsAt: mock.endsAt, requestKey: mock.requestKey };
    this.mocks.push(record);
    return record;
  }
  async savePlan(_userId: string, id: string, plan: MockPlan) {
    const index = this.mocks.findIndex((mock) => mock.id === id && !mock.finishedAt);
    if (index < 0) return false;
    this.mocks[index] = { ...this.mocks[index], plan };
    return true;
  }
  async finish(_userId: string, id: string, finishedAt: Date, result: MockResult) {
    this.finishCalls++;
    const index = this.mocks.findIndex((mock) => mock.id === id && !mock.finishedAt);
    if (index < 0) return false;
    this.mocks[index] = { ...this.mocks[index], finishedAt, result };
    return true;
  }
  async recent() { return [...this.mocks].reverse(); }
  async attemptedContentIds() { return this.attempted; }
  async submissionsFor() { return this.submissions; }
}

function harness(options: { now?: Date; random?: number } = {}) {
  const store = new FakeMockStore();
  const clock = { now: options.now ?? T0 };
  const service = new MockService({
    store,
    quests: { listVisibleQuests: async () => QUESTS, getVisibleQuest: async (_userId, id) => QUESTS.find((q) => q.contentVersionId === id) },
    clock: () => clock.now,
    random: () => options.random ?? 0,
  });
  return { store, clock, service };
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error(`expected ApiError, got ${String(error)}`);
  return error;
}

describe("MockService.start", () => {
  it("start_noUnseenInterviewProblems_is409", async () => {
    const { store, service } = harness();
    store.attempted = new Set(["problems.pair-sum", "workshop.lru-cache"]);

    expect((await apiError(service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" }))).code).toBe("no_unseen_problems");
  });

  it("start_picksOnlyUnattemptedProblemsFromInterviewCampaigns", async () => {
    const { store, service } = harness({ random: 0.99 });
    store.attempted = new Set(["workshop.lru-cache"]);

    expect((await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" })).problem.contentVersionId).toBe("cv-problems.pair-sum");
  });

  it("start_setsTheDeadlineFromTheChosenDuration", async () => {
    const { service } = harness();

    expect((await service.start(USER, { durationMinutes: 60, requestKey: "key-00000001" })).endsAt).toBe(minutesAfter(60).toISOString());
  });

  it("start_whileAMockIsRunning_returnsTheRunningOne", async () => {
    const { service } = harness();
    const first = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });

    expect((await service.start(USER, { durationMinutes: 60, requestKey: "key-00000002" })).id).toBe(first.id);
  });

  it("start_repeatedRequestKey_returnsTheOriginalEvenAfterItFinished", async () => {
    const { service } = harness();
    const first = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });
    await service.finish(USER, first.id);

    expect((await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" })).id).toBe(first.id);
  });

  it("start_afterTheRunningMockExpired_scoresItAndStartsANewOne", async () => {
    const { store, clock, service } = harness();
    const first = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });
    clock.now = minutesAfter(46);

    const second = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000002" });

    expect([second.id !== first.id, store.mocks[0].finishedAt?.toISOString()]).toEqual([true, minutesAfter(45).toISOString()]);
  });
});

describe("MockService hints, plans and finishing", () => {
  it("hintsBlocked_onlyForTheRunningMocksProblem", async () => {
    const { service } = harness();
    const mock = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });

    expect([await service.hintsBlocked(USER, mock.problem.contentVersionId), await service.hintsBlocked(USER, "cv-other")]).toEqual([true, false]);
  });

  it("hintsBlocked_afterTheDeadline_isFalse", async () => {
    const { clock, service } = harness();
    const mock = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });
    clock.now = minutesAfter(45);

    expect(await service.hintsBlocked(USER, mock.problem.contentVersionId)).toBe(false);
  });

  it("hintsBlocked_afterFinishing_isFalse", async () => {
    const { service } = harness();
    const mock = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });
    await service.finish(USER, mock.id);

    expect(await service.hintsBlocked(USER, mock.problem.contentVersionId)).toBe(false);
  });

  it("savePlan_afterFinishing_is409", async () => {
    const { service } = harness();
    const mock = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });
    await service.finish(USER, mock.id);

    expect((await apiError(service.savePlan(USER, mock.id, { clarify: "late" }))).code).toBe("mock_finished");
  });

  it("savePlan_unknownField_isRejected", async () => {
    const { service } = harness();
    const mock = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });

    await expect(service.savePlan(USER, mock.id, { clarify: "ok", secret: "x" })).rejects.toThrow();
  });

  it("finish_twice_keepsTheFirstResult", async () => {
    const { store, clock, service } = harness();
    const mock = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });
    clock.now = minutesAfter(10);
    const first = await service.finish(USER, mock.id);
    store.submissions = [{ createdAt: minutesAfter(5), outcome: "succeeded", cases: [{ passed: true }] }];

    const second = await service.finish(USER, mock.id);

    expect([second.result, store.finishCalls]).toEqual([first.result, 1]);
  });

  it("finish_scoresSubmissionsMadeDuringTheMock", async () => {
    const { store, clock, service } = harness();
    const mock = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });
    store.submissions = [{ createdAt: minutesAfter(12), outcome: "succeeded", cases: [{ passed: true }] }];
    clock.now = minutesAfter(20);

    expect((await service.finish(USER, mock.id)).result?.solved).toBe(true);
  });

  it("get_unknownMock_is404", async () => {
    expect((await apiError(harness().service.get(USER, "missing"))).status).toBe(404);
  });

  it("get_expiredRunningMock_isScoredAtItsDeadline", async () => {
    const { clock, service } = harness();
    const mock = await service.start(USER, { durationMinutes: 45, requestKey: "key-00000001" });
    clock.now = minutesAfter(90);

    expect((await service.get(USER, mock.id)).state).toBe("finished");
  });
});
