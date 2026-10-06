import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign-in problem · CodeQuest" };

const MESSAGES: Record<string, string> = {
  missing_code: "That sign-in link is incomplete.",
  link_invalid: "That sign-in link has expired, was already used, or was opened in a different browser from the one that requested it.",
};

export default async function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  const reason = (await searchParams).reason;
  const message = (typeof reason === "string" && MESSAGES[reason]) || "Something went wrong while signing in.";
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-xl font-semibold">Couldn&apos;t sign you in</h1>
      <p className="text-sm text-neutral-700 dark:text-neutral-300">{message}</p>
      <Link href="/login" className="font-medium text-indigo-700 underline underline-offset-4 dark:text-indigo-400">
        Request a new link
      </Link>
    </main>
  );
}
