import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { ContentSyncError, syncContent } from "@/lib/content/sync";
import { closeSql, sql } from "./support/local-supabase";

/**
 * content:sync against the local database, using a throwaway copy of the curriculum renamed to
 * a test-only id so real content rows are never touched.
 */

const REAL_CONTENT = join(import.meta.dirname, "..", "..", "content");
const SOURCE_ID = "problems.pattern-lower-bound";
let root: string;
let testId: string;

function itemPath(...parts: string[]): string {
  return join(root, "public", testId, ...parts);
}

function editManifest(edit: (manifest: Record<string, unknown>) => void): void {
  const path = itemPath("item.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  edit(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

function publish(manifest: Record<string, unknown>): void {
  manifest.review = { status: "published", reviewer: "Test Reviewer", reviewedAt: "2026-10-06" };
}

async function versionRow() {
  const [row] = await sql()`select status::text as status, payload->>'title' as title from public.content_versions where content_id = ${testId}`;
  return row;
}

beforeEach(() => {
  testId = `test.sync-${crypto.randomUUID().slice(0, 8)}`;
  root = mkdtempSync(join(tmpdir(), "codequest-content-"));
  cpSync(join(REAL_CONTENT, "skills.json"), join(root, "skills.json"));
  writeFileSync(
    join(root, "campaigns.json"),
    JSON.stringify({ campaigns: [{ id: "campaign.test-sync", title: "Sync test", summary: "A campaign for sync tests.", world: "world.java-awakening", kind: "project" }] }),
  );
  cpSync(join(REAL_CONTENT, "public", SOURCE_ID), join(root, "public", testId), { recursive: true });
  cpSync(join(REAL_CONTENT, "private", SOURCE_ID), join(root, "private", testId), { recursive: true });
  editManifest((manifest) => {
    manifest.id = testId;
    manifest.campaign = { id: "campaign.test-sync", order: 1 };
  });
});

afterEach(async () => {
  rmSync(root, { recursive: true, force: true });
  // Published versions can't be deleted by design; drop the test rows via a trigger-free path.
  await sql().begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from public.content_versions where content_id = ${testId}`;
    await tx`delete from public.content_items where id = ${testId}`;
  });
});

afterAll(async () => {
  await closeSql();
});

describe("syncContent", () => {
  it("syncContent_runTwice_isIdempotent", async () => {
    await syncContent(sql(), loadContent(root));

    const second = await syncContent(sql(), loadContent(root));

    expect(second.unchanged).toContain(`${testId}@v1`);
    expect([...second.inserted, ...second.updated].filter((label) => label.startsWith(testId))).toEqual([]);
  });

  it("syncContent_draftEdited_updatesInPlace", async () => {
    await syncContent(sql(), loadContent(root));
    editManifest((manifest) => {
      manifest.title = "First at least, revised";
    });

    const report = await syncContent(sql(), loadContent(root));

    expect([report.updated.includes(`${testId}@v1`), (await versionRow()).title]).toEqual([true, "First at least, revised"]);
  });

  it("syncContent_publishedPayloadChanged_refusesAndRollsBackEverything", async () => {
    editManifest(publish);
    await syncContent(sql(), loadContent(root));
    editManifest((manifest) => {
      manifest.title = "Silently changed after publishing";
    });
    const skillsPath = join(root, "skills.json");
    const skillsFile = JSON.parse(readFileSync(skillsPath, "utf8")) as { skills: Array<{ id: string; name: string }> };
    skillsFile.skills[0].name = "Renamed in the same sync";
    writeFileSync(skillsPath, JSON.stringify(skillsFile));

    await expect(syncContent(sql(), loadContent(root))).rejects.toBeInstanceOf(ContentSyncError);

    const [skill] = await sql()`select name from public.skills where id = ${skillsFile.skills[0].id}`;
    expect([(await versionRow()).title, skill.name]).toEqual(["First at least", "Methods"]);
  });

  it("syncContent_publishedHiddenGradingChanged_refuses", async () => {
    editManifest(publish);
    await syncContent(sql(), loadContent(root));
    const privatePath = join(root, "private", testId, "private.json");
    const privateData = JSON.parse(readFileSync(privatePath, "utf8")) as { hints: Array<{ text: string }> };
    privateData.hints[0].text = "A quietly different hint after publishing.";
    writeFileSync(privatePath, JSON.stringify(privateData));

    await expect(syncContent(sql(), loadContent(root))).rejects.toThrow(/hidden grading can't change/);
  });

  it("syncContent_publishedToDeprecated_isAllowed", async () => {
    editManifest(publish);
    await syncContent(sql(), loadContent(root));
    editManifest((manifest) => {
      manifest.review = { status: "deprecated", reviewer: "Test Reviewer", reviewedAt: "2026-10-06" };
    });

    await syncContent(sql(), loadContent(root));

    expect((await versionRow()).status).toBe("deprecated");
  });

  it("syncContent_newVersionAfterPublishing_isInsertedAlongside", async () => {
    editManifest(publish);
    await syncContent(sql(), loadContent(root));
    editManifest((manifest) => {
      manifest.version = 2;
      manifest.title = "Checkout totals v2";
      manifest.review = { status: "draft" };
    });

    const report = await syncContent(sql(), loadContent(root));

    const [{ count }] = await sql()`select count(*)::int as count from public.content_versions where content_id = ${testId}`;
    expect([report.inserted, count]).toEqual([[`${testId}@v2`], 2]);
  });

  it("syncContent_hiddenGradingStoredOnlyInPrivateSchema", async () => {
    await syncContent(sql(), loadContent(root));

    const [{ payload_has_expect, secret_has_expect }] = await sql()`
      select (v.payload::text like '%"expect"%') as payload_has_expect,
             (s.hidden_grading::text like '%"expect"%') as secret_has_expect
      from public.content_versions v join private.content_secrets s on s.content_version_id = v.id
      where v.content_id = ${testId}`;
    expect([payload_has_expect, secret_has_expect]).toEqual([false, true]);
  });
});
