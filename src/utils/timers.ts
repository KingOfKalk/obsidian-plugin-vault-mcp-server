import {
  clearInterval as nodeClearInterval,
  setInterval as nodeSetInterval,
  setTimeout as nodeSetTimeout,
} from 'node:timers';

/**
 * Timers that work inside Obsidian and outside it (#557).
 *
 * In Obsidian they are the main window's (`window.setInterval`, …), as the
 * plugin guidelines ask: those keep running when a popout window is focused
 * or closed. The server code also runs where there is no window (unit tests,
 * `evals/harness.ts`, the doc scripts); there Node's `timers` module stands
 * in. `window` is looked up on every call, so a test can stub it (for
 * example to use Vitest's fake timers, which do not replace `node:timers`).
 */

/** Stops the timer; calling it again does nothing. */
export type StopTimer = () => void;

export interface IntervalOptions {
  /**
   * Outside Obsidian, do not keep the Node process alive just for this
   * timer (`Timeout.unref()`). A window timer never keeps anything alive.
   */
  unref?: boolean;
}

/** Run `callback` every `ms` milliseconds until the returned function is called. */
export function startInterval(
  callback: () => void,
  ms: number,
  options: IntervalOptions = {},
): StopTimer {
  if (typeof window !== 'undefined') {
    const id = window.setInterval(callback, ms);
    return (): void => {
      window.clearInterval(id);
    };
  }
  const timer = nodeSetInterval(callback, ms);
  if (options.unref === true) {
    timer.unref();
  }
  return (): void => {
    nodeClearInterval(timer);
  };
}

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined') {
      window.setTimeout(resolve, ms);
    } else {
      nodeSetTimeout(resolve, ms);
    }
  });
}
