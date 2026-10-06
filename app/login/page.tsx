import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · CodeQuest" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const raw = (await searchParams).next;
  const next = safeRedirectPath(typeof raw === "string" ? raw : undefined);
  if (await getSessionUser()) redirect(next);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">CodeQuest</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Sign in with the email that owns this CodeQuest.</p>
      </div>
      <SignInForm next={next} />
    </main>
  );
}
