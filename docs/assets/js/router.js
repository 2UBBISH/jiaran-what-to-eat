/** hash 路由：GitHub Pages 上无需服务端 rewrite，#/xxx 刷新也不会 404 */

export function createRouter({ fallback = 'draw', onRoute } = {}) {
  function parse(hash = location.hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    const [path, query] = raw.split('?');
    return {
      name: (path || fallback).split('/')[0] || fallback,
      params: new URLSearchParams(query || ''),
    };
  }

  function handle() {
    const route = parse();
    onRoute?.(route);
  }

  return {
    start() {
      window.addEventListener('hashchange', handle);
      handle();
    },
    stop() {
      window.removeEventListener('hashchange', handle);
    },
    parse,
    navigate(to) {
      const next = to.startsWith('#') ? to : `#/${to}`;
      if (location.hash === next) handle();
      else location.hash = next;
    },
  };
}

export function currentUrlFor(hash) {
  return `${location.origin}${location.pathname}${hash}`;
}
