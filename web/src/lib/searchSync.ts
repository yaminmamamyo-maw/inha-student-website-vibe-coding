// Debounces committing a search box's value, but never while an IME composition (Korean/Japanese/
// Chinese input) is in progress: committing mid-composition — e.g. round-tripping through the URL —
// resets the input and breaks the composed characters. Pure, no React/DOM.
export function createSearchSync(commit: (value: string) => void, delay = 250) {
  let composing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (value: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => commit(value), delay);
  };

  return {
    isComposing: () => composing,
    onCompositionStart() {
      composing = true;
    },
    /** Call on every keystroke; ignored while composing. */
    onChange(value: string) {
      if (!composing) schedule(value);
    },
    /** Call when composition ends, with the input's final value. */
    onCompositionEnd(value: string) {
      composing = false;
      schedule(value);
    },
    /** Commit immediately (e.g. a "clear" button), cancelling any pending debounce. */
    commitNow(value: string) {
      clearTimeout(timer);
      commit(value);
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
