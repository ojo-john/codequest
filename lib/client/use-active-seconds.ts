"use client";

import { useCallback, useEffect, useRef } from "react";

const IDLE_AFTER_MS = 60_000;

/**
 * Active time on a task (spec §61): counts seconds only while the tab is visible and the learner
 * did something in the last minute. Idle time is never counted; no keystroke content is recorded.
 */
export function useActiveSeconds(): { take: () => number } {
  const seconds = useRef(0);
  const lastActivity = useRef(0);

  useEffect(() => {
    lastActivity.current = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events = ["keydown", "pointerdown", "wheel"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    const tick = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity.current < IDLE_AFTER_MS) seconds.current += 1;
    }, 1000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      clearInterval(tick);
    };
  }, []);

  const take = useCallback(() => {
    const value = seconds.current;
    seconds.current = 0;
    return value;
  }, []);
  return { take };
}
