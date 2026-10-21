import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  query: URLSearchParams;
}

const ROUTE_EVENT = 'octoforge:navigate';

function current(): Route {
  return {
    path: window.location.pathname.replace(/\/+$/, '') || '/',
    query: new URLSearchParams(window.location.search),
  };
}

export function navigate(path: string, opts: { replace?: boolean; query?: URLSearchParams } = {}): void {
  const search = opts.query && [...opts.query.keys()].length ? `?${opts.query.toString()}` : '';
  const url = `${path}${search}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  if (opts.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const update = () => setRoute(current());
    window.addEventListener('popstate', update);
    window.addEventListener(ROUTE_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(ROUTE_EVENT, update);
    };
  }, []);
  return route;
}

/** Intercepts same-origin anchor clicks so the SPA handles them without a reload. */
export function linkClick(path: string) {
  return (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
    if (e.metaKey || e.ctrlKey || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    navigate(path);
  };
}
