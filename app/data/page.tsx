import { AppHeader } from "@/components/app-header";
import { DeleteDataForm, ImportArchiveForm } from "@/components/data/data-controls";
import { Card } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/dal";
import { DELETE_CONFIRMATION_PHRASE } from "@/lib/server/archive-service";
import { createUserClient } from "@/lib/supabase/server";

const dateFormat = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" });

/** Your data (spec §47, §61, §63, §68): export, import, project ZIPs and deletion. */
export default async function DataPage() {
  const user = await requirePageUser("/data");
  const supabase = await createUserClient();
  const { data: projects, error } = await supabase.from("projects").select("id, title, updated_at").order("updated_at", { ascending: false });

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your data</h1>
          <p className="text-neutral-600 dark:text-neutral-400">Everything CodeQuest stores about you can be downloaded, restored or erased here.</p>
        </div>

        <Card>
          <h2 className="mb-1 font-semibold">Download an archive</h2>
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            One JSON file with your sessions, attempts, skill estimates, XP, hints, projects and notes. It&apos;s signed by
            CodeQuest, so it can restore your progress later — editing the file keeps your code restorable but not your progress.
          </p>
          <a
            href="/api/v1/archive"
            download
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Download archive (.json)
          </a>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">Restore from an archive</h2>
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            Adds what&apos;s in the archive to your account. Nothing you already have is overwritten, and restoring the same file twice changes nothing.
          </p>
          <ImportArchiveForm />
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">Projects</h2>
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">Download a project&apos;s Java files as a ZIP to open in any IDE.</p>
          {error ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">Couldn&apos;t load your projects. Try reloading.</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">No projects yet — they&apos;re created when you open your first quest.</p>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {projects.map((project) => (
                <li key={project.id} className="flex items-center justify-between gap-4 py-2">
                  <span>
                    <span className="font-medium">{project.title}</span>
                    <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">updated {dateFormat.format(new Date(project.updated_at))}</span>
                  </span>
                  <a href={`/api/v1/projects/${project.id}/zip`} download className="text-sm text-indigo-700 underline underline-offset-4 dark:text-indigo-300">
                    Download ZIP
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-red-300 dark:border-red-900">
          <h2 className="mb-1 font-semibold">Erase progress and projects</h2>
          <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
            Permanently deletes your sessions, attempts, skill estimates, XP, hints, projects and notes. Your account stays, so you can still sign in.
            Download an archive first if you might want any of it back.
          </p>
          <DeleteDataForm phrase={DELETE_CONFIRMATION_PHRASE} />
        </Card>
      </main>
    </>
  );
}
