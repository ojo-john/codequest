import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { StoryEditor } from "@/components/stories/story-editor";
import { requirePageUser } from "@/lib/auth/dal";
import { storyService } from "@/lib/server/container";
import { ApiError } from "@/lib/server/http";

export const metadata: Metadata = { title: "Story · CodeQuest" };

export default async function StoryPage({ params }: PageProps<"/stories/[id]">) {
  const { id } = await params;
  const user = await requirePageUser(`/stories/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let view;
  try {
    view = await storyService().get(user.userId, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <>
      <AppHeader email={user.email} />
      <StoryEditor initial={view.story} initialChecks={view.checks} />
    </>
  );
}
