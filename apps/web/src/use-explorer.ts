import { useEffect, useRef, useState } from 'react';
import type { ExplorerData, Report } from '../../../libs/contracts/src';
import { fetchExplorer } from './client';

interface ExplorerState {
  status: 'loading' | 'success' | 'error';
  filterKey: string;
  data: ExplorerData | null;
  error: string | null;
}

export function useExplorer(cityId: number | null, quarterId: number | null) {
  const filterKey = `${cityId ?? 'all'}:${quarterId ?? 'all'}`;
  const [revision, setRevision] = useState(0);
  const activeRead = useRef<AbortController | null>(null);
  const [state, setState] = useState<ExplorerState>({
    status: 'loading', filterKey, data: null, error: null,
  });
  useEffect(() => {
    const controller = new AbortController();
    activeRead.current = controller;
    setState((previous) => ({ ...previous, filterKey, status: 'loading', error: null }));
    fetchExplorer({ cityId, quarterId }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'success', filterKey, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState((previous) => ({
            ...previous,
            status: 'error',
            error: error instanceof Error ? error.message : 'Onbekende fout bij het laden.',
          }));
        }
      });
    const timer = window.setInterval(() => setRevision((value) => value + 1), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [cityId, quarterId, filterKey, revision]);
  function confirmReport(report: Report) {
    // A read begun before this confirmation must not overwrite it with stale status.
    activeRead.current?.abort();
    setState((previous) => ({
      ...previous, status: 'success', error: null,
      data: previous.data ? {
        ...previous.data,
        reports: previous.data.reports.map((item) => item.id === report.id ? structuredClone(report) : item),
      } : null,
    }));
    setRevision((value) => value + 1);
  }
  // Child effects run before this hook's read effect. Never expose old-filter
  // success for that intermediate render (it could fit/enable the wrong map).
  const status = state.filterKey === filterKey ? state.status : 'loading';
  return { ...state, status, confirmReport, retry: () => setRevision((value) => value + 1) };
}
