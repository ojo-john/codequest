import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import type { ArchiveData } from "@/lib/archive/archive-schema";
import { loadArchiveSigningKey, signArchive } from "@/lib/archive/archive-signing";
import { DEFAULT_EXECUTION_LIMITS } from "@/lib/execution/limits";
import { silentLogger } from "@/lib/observability/log";
import {
  ArchiveService,
  DELETE_CONFIRMATION_PHRASE,
  MissingReferencesError,
  type ArchiveStore,
  type ImportReport,
  type ProjectExport,
} from "@/lib/server/archive-service";
import { ApiError } from "@/lib/server/http";
import { StoreError } from "@/lib/server/learning-store";
import { archiveData, EXPORTER_ID, unsignedArchive } from "../archive/archive-builders";

const KEY = loadArchiveSigningKey({ ARCHIVE_SIGNING_KEY: Buffer.alloc(32, 3).toString("base64") })!;
const NOW = new Date("2026-10-08T12:00:00.000Z");
const OTHER_USER = "99999999-9999-4999-8999-999999999999";

class FakeArchiveStore implements ArchiveStore {
  exported: unknown = archiveData();
  imports: Array<{ userId: string; data: ArchiveData; includeProgress: boolean }> = [];
  deleted: string[] = [];
  projects = new Map<string, ProjectExport>();
  importError: Error | undefined;

  async exportUserData(): Promise<unknown> {
    return this.exported;
  }
  async importUserData(userId: string, data: ArchiveData, includeProgress: boolean): Promise<ImportReport> {
    if (this.importError) throw this.importError;
    this.imports.push({ userId, data, includeProgress });
    return { projects: { imported: data.projects.length, skipped: 0 } };
  }
  async deleteUserData(userId: string): Promise<void> {
    this.deleted.push(userId);
  }
  async getProject(userId: string, projectId: string): Promise<ProjectExport | undefined> {
    return userId === EXPORTER_ID ? this.projects.get(projectId) : undefined;
  }
}

function service(store: ArchiveStore, signingKey = KEY): ArchiveService {
  return new ArchiveService({ store, signingKey, limits: DEFAULT_EXECUTION_LIMITS, logger: silentLogger, clock: () => NOW });
}

function signed(data = archiveData()) {
  const archive = unsignedArchive({ data });
  return { ...archive, signature: signArchive(KEY, archive) };
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error(`expected ApiError, got ${String(error)}`);
  return error;
}

describe("ArchiveService.exportArchive", () => {
  it("exportArchive_withKey_returnsArchiveSignedForTheLearner", async () => {
    const archive = await service(new FakeArchiveStore()).exportArchive(EXPORTER_ID);

    expect({ subject: archive.subject, exportedAt: archive.exportedAt, keyId: archive.signature?.keyId }).toEqual({
      subject: EXPORTER_ID,
      exportedAt: NOW.toISOString(),
      keyId: KEY.id,
    });
  });

  it("exportArchive_withoutKey_isUnsigned", async () => {
    const archive = await new ArchiveService({ store: new FakeArchiveStore(), signingKey: undefined, limits: DEFAULT_EXECUTION_LIMITS, logger: silentLogger }).exportArchive(EXPORTER_ID);

    expect(archive.signature).toBeNull();
  });

  it("exportArchive_storeReturnsMalformedData_throwsServerErrorNotValidationError", async () => {
    const store = new FakeArchiveStore();
    store.exported = { sessions: "not an array" };

    const error = await service(store).exportArchive(EXPORTER_ID).catch((caught: unknown) => caught);

    expect([error instanceof Error && !(error instanceof ApiError), (error as Error).message]).toEqual([true, expect.stringContaining("invalid archive")]);
  });

  it("exportArchive_storeUnavailable_propagatesStoreError", async () => {
    const store = new FakeArchiveStore();
    store.exportUserData = async () => {
      throw new StoreError("export_user_data", "timeout");
    };

    await expect(service(store).exportArchive(EXPORTER_ID)).rejects.toBeInstanceOf(StoreError);
  });

  it("exportArchive_thenImport_restoresProgress", async () => {
    const store = new FakeArchiveStore();
    const archive = await service(store).exportArchive(EXPORTER_ID);

    const result = await service(store).importArchive(EXPORTER_ID, JSON.parse(JSON.stringify(archive)));

    expect([result.signature, result.progressRestored]).toEqual(["valid", true]);
  });
});

describe("ArchiveService.importArchive", () => {
  it("importArchive_signedArchive_restoresProgress", async () => {
    const store = new FakeArchiveStore();

    await service(store).importArchive(EXPORTER_ID, signed());

    expect(store.imports[0].includeProgress).toBe(true);
  });

  it("importArchive_editedSignedArchive_restoresProjectsOnly", async () => {
    const store = new FakeArchiveStore();
    const archive = signed();
    archive.data.xp_events[0].delta = 1000;

    const result = await service(store).importArchive(EXPORTER_ID, archive);

    expect([result.signature, store.imports[0].includeProgress]).toEqual(["invalid", false]);
  });

  it("importArchive_unsignedArchive_restoresProjectsOnly", async () => {
    const store = new FakeArchiveStore();

    const result = await service(store).importArchive(EXPORTER_ID, { ...unsignedArchive(), signature: null });

    expect([result.signature, store.imports[0].includeProgress]).toEqual(["missing", false]);
  });

  it("importArchive_serverWithoutKey_restoresProjectsOnly", async () => {
    const store = new FakeArchiveStore();

    const result = await new ArchiveService({ store, signingKey: undefined, limits: DEFAULT_EXECUTION_LIMITS, logger: silentLogger }).importArchive(EXPORTER_ID, signed());

    expect([result.signature, store.imports[0].includeProgress]).toEqual(["unknown_key", false]);
  });

  it("importArchive_sameAccount_keepsIds", async () => {
    const store = new FakeArchiveStore();

    await service(store).importArchive(EXPORTER_ID, signed());

    expect(store.imports[0].data.attempts[0].id).toBe(archiveData().attempts[0].id);
  });

  it("importArchive_otherAccount_remapsIdsAndImportsForTheCaller", async () => {
    const store = new FakeArchiveStore();

    await service(store).importArchive(OTHER_USER, signed());

    expect([store.imports[0].userId, store.imports[0].data.attempts[0].id === archiveData().attempts[0].id]).toEqual([OTHER_USER, false]);
  });

  it("importArchive_notAnArchive_rejects422", async () => {
    const error = await apiError(service(new FakeArchiveStore()).importArchive(EXPORTER_ID, { hello: "world" }));

    expect([error.status, error.code]).toEqual([422, "not_an_archive"]);
  });

  it("importArchive_newerFormatVersion_rejects422", async () => {
    const error = await apiError(service(new FakeArchiveStore()).importArchive(EXPORTER_ID, { ...signed(), version: 2 }));

    expect(error.code).toBe("unsupported_archive_version");
  });

  it("importArchive_malformedRow_rejects422BeforeTouchingTheStore", async () => {
    const store = new FakeArchiveStore();
    const archive = signed();
    (archive.data.attempts[0] as { hint_level: number }).hint_level = 99;

    const error = await apiError(service(store).importArchive(EXPORTER_ID, archive));

    expect([error.code, store.imports]).toEqual(["archive_invalid", []]);
  });

  it("importArchive_thousandsOfBadRows_reportsAtMost20Issues", async () => {
    const data = archiveData();
    const archive = signed({ ...data, notes: Array.from({ length: 500 }, () => ({ ...data.notes[0], body: "" })) });

    const error = await apiError(service(new FakeArchiveStore()).importArchive(EXPORTER_ID, archive));

    expect((error.details as unknown[]).length).toBe(20);
  });

  it("importArchive_projectFileWithTraversalPath_rejects422", async () => {
    const data = archiveData();
    const archive = signed({ ...data, project_files: [{ ...data.project_files[0], path: "../etc/Passwd.java" }] });

    const error = await apiError(service(new FakeArchiveStore()).importArchive(EXPORTER_ID, archive));

    expect(error.code).toBe("archive_projects_invalid");
  });

  it("importArchive_projectOverSizeLimit_rejects422", async () => {
    const data = archiveData();
    const big = "x".repeat(DEFAULT_EXECUTION_LIMITS.maxTotalSourceBytes + 1);
    const archive = signed({ ...data, project_files: [{ ...data.project_files[0], source: big }] });

    const error = await apiError(service(new FakeArchiveStore()).importArchive(EXPORTER_ID, archive));

    expect(error.code).toBe("archive_projects_invalid");
  });

  it("importArchive_fileForProjectNotInArchive_rejects422", async () => {
    const data = archiveData();
    const archive = signed({ ...data, project_files: [{ ...data.project_files[0], project_id: OTHER_USER }] });

    const error = await apiError(service(new FakeArchiveStore()).importArchive(EXPORTER_ID, archive));

    expect(error.details).toEqual([{ projectId: OTHER_USER, issues: [{ code: "unknown_project" }] }]);
  });

  it("importArchive_contentMissingFromDatabase_rejects422WithReferences", async () => {
    const store = new FakeArchiveStore();
    store.importError = new MissingReferencesError(["content cart.q1-checkout-totals@v1"]);

    const error = await apiError(service(store).importArchive(EXPORTER_ID, signed()));

    expect([error.code, error.details]).toEqual(["archive_references_missing", ["content cart.q1-checkout-totals@v1"]]);
  });

  it("importArchive_storeUnavailable_propagatesStoreError", async () => {
    const store = new FakeArchiveStore();
    store.importError = new StoreError("import_user_data", "connection reset");

    await expect(service(store).importArchive(EXPORTER_ID, signed())).rejects.toBeInstanceOf(StoreError);
  });
});

describe("ArchiveService.deleteAllData", () => {
  it("deleteAllData_withPhrase_deletesTheCallersData", async () => {
    const store = new FakeArchiveStore();

    await service(store).deleteAllData(EXPORTER_ID, `  ${DELETE_CONFIRMATION_PHRASE.toUpperCase()} `);

    expect(store.deleted).toEqual([EXPORTER_ID]);
  });

  it.each([[""], ["delete"], ["yes"]])("deleteAllData_confirmation'%s'_rejectsAndDeletesNothing", async (confirmation) => {
    const store = new FakeArchiveStore();

    const error = await apiError(service(store).deleteAllData(EXPORTER_ID, confirmation));

    expect([error.code, store.deleted]).toEqual(["confirmation_required", []]);
  });
});

describe("ArchiveService.projectZip", () => {
  const PROJECT = "a0000000-0000-4000-8000-000000000006";

  it("projectZip_ownProject_containsEveryFileUnderAProjectFolder", async () => {
    const store = new FakeArchiveStore();
    store.projects.set(PROJECT, { title: "Shopping Cart!", files: [{ path: "shop/Cart.java", content: "class Cart {}" }, { path: "Main.java", content: "class Main {}" }] });

    const zip = await service(store).projectZip(EXPORTER_ID, PROJECT);

    const entries = unzipSync(zip.bytes);
    expect({ name: zip.fileName, files: Object.fromEntries(Object.entries(entries).map(([path, bytes]) => [path, new TextDecoder().decode(bytes)])) }).toEqual({
      name: "shopping-cart.zip",
      files: { "shopping-cart/shop/Cart.java": "class Cart {}", "shopping-cart/Main.java": "class Main {}" },
    });
  });

  it("projectZip_sameProjectTwice_isByteIdentical", async () => {
    const store = new FakeArchiveStore();
    store.projects.set(PROJECT, { title: "p", files: [{ path: "A.java", content: "class A {}" }] });

    const [a, b] = [await service(store).projectZip(EXPORTER_ID, PROJECT), await service(store).projectZip(EXPORTER_ID, PROJECT)];

    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it("projectZip_someoneElsesProject_rejects404", async () => {
    const store = new FakeArchiveStore();
    store.projects.set(PROJECT, { title: "p", files: [] });

    const error = await apiError(service(store).projectZip(OTHER_USER, PROJECT));

    expect(error.status).toBe(404);
  });

  it("projectZip_titleWithoutLetters_usesProjectAsFolder", async () => {
    const store = new FakeArchiveStore();
    store.projects.set(PROJECT, { title: "!!!", files: [{ path: "A.java", content: "" }] });

    expect((await service(store).projectZip(EXPORTER_ID, PROJECT)).fileName).toBe("project.zip");
  });
});
