/**
 * Backend Keep-Alive Service
 *
 * Render free-tier containers sleep after ~15 minutes of inactivity.
 * This service sends a silent /health ping every 10 minutes while the
 * app is in the foreground, keeping the container warm.
 *
 * Usage: call `startKeepAlive()` once after app launch, `stopKeepAlive()`
 * when the app goes to background (AppState change).
 */
import { AppState, AppStateStatus } from "react-native";
import { HEALTH_URL } from "@/config/api";

const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let intervalId: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

async function ping(): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    await fetch(HEALTH_URL, { method: "GET", signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
  } catch {
    // Silent — keep-alive failures should never surface to the user
  }
}

function start(): void {
  if (intervalId !== null) return; // already running
  intervalId = setInterval(ping, INTERVAL_MS);
}

function stop(): void {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

function handleAppStateChange(nextState: AppStateStatus): void {
  if (nextState === "active") {
    start();
  } else {
    stop();
  }
}

/**
 * Call once at app startup. Automatically pauses pings when the app goes
 * to background and resumes when it returns to the foreground.
 */
export function initKeepAlive(): void {
  if (appStateSubscription) return; // already initialised
  start(); // start immediately for the current foreground session
  appStateSubscription = AppState.addEventListener("change", handleAppStateChange);
}
