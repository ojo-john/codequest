"use client";

import { useActionState } from "react";
import { requestSignInLink, type SignInState } from "./actions";

const INITIAL: SignInState = { status: "idle" };

export function SignInForm({ next }: { readonly next: string }) {
  const [state, action, pending] = useActionState(requestSignInLink, INITIAL);

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-lg border border-emerald-600/40 bg-emerald-50 p-4 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
        <p className="font-medium">Check your email.</p>
        <p className="mt-1">
          If <span className="font-mono">{state.email}</span> has access to CodeQuest, a sign-in link is on its way. Open it in this
          browser; it expires in 10 minutes.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        aria-invalid={state.status === "invalid"}
        aria-describedby={state.status === "invalid" || state.status === "error" ? "sign-in-message" : undefined}
        className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
      />
      {(state.status === "invalid" || state.status === "error") && (
        <p id="sign-in-message" role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
