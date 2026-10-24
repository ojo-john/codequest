import "server-only";
import type { Cheatsheet } from "@/lib/cheatsheets/cheatsheets";
import type { ContentStatus } from "./learning-store";
import { ApiError } from "./http";

/** Cheat sheets for one learner (spec §52): drafts only after the opt-in; none during a mock. */

export interface CheatsheetServiceDeps {
  readonly sheets: () => readonly Cheatsheet[];
  readonly visibleStatuses: (userId: string) => Promise<readonly ContentStatus[]>;
  readonly mocks: { isRunning(userId: string): Promise<boolean> };
}

export type CheatsheetAccess = { readonly hidden: "mock_in_progress" } | { readonly hidden?: undefined; readonly sheets: readonly Cheatsheet[] };

export class CheatsheetService {
  constructor(private readonly deps: CheatsheetServiceDeps) {}

  async list(userId: string): Promise<CheatsheetAccess> {
    if (await this.deps.mocks.isRunning(userId)) return { hidden: "mock_in_progress" };
    const statuses = await this.deps.visibleStatuses(userId);
    return { sheets: this.deps.sheets().filter((sheet) => statuses.includes(sheet.review.status)) };
  }

  async get(userId: string, id: string): Promise<{ hidden: "mock_in_progress" } | { sheet: Cheatsheet }> {
    const access = await this.list(userId);
    if (access.hidden) return access;
    const sheet = access.sheets.find((candidate) => candidate.id === id);
    if (!sheet) throw new ApiError(404, "not_found", "That cheat sheet doesn't exist or isn't available to you.");
    return { sheet };
  }
}
