/** 极简状态容器：订阅式，无依赖。视图只读 state，改状态一律走 set。 */

export function createStore(initialState = {}) {
  let state = { ...initialState };
  const listeners = new Set();

  function get() {
    return state;
  }

  function set(patch) {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (!next) return state;
    state = { ...state, ...next };
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        console.error('[store] listener failed', error);
      }
    });
    return state;
  }

  function subscribe(listener, { immediate = true } = {}) {
    listeners.add(listener);
    if (immediate) listener(state);
    return () => listeners.delete(listener);
  }

  return { get, set, subscribe };
}
