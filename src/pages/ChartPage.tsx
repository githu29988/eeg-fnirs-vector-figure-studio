import { useParams, Link } from 'react-router-dom';
import { findChart } from '../registry';

export function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const entry = id ? findChart(id) : undefined;

  if (!entry) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-16 text-center">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
          404
        </p>
        <h1 className="mt-2 font-serif text-3xl">Chart not found</h1>
        <p className="mt-3 text-ink-300">
          The slug <code className="font-mono">{id}</code> isn't in the registry.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded border border-ink-600 bg-ink-800 px-4 py-2 text-sm hover:border-accent hover:text-accent"
        >
          Back to overview
        </Link>
      </div>
    );
  }

  const Chart = entry.component;
  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
          {entry.category}
        </p>
        <h1 className="mt-1 font-serif text-2xl leading-tight">
          {entry.title}
        </h1>
        {entry.titleZh ? (
          <p className="mt-1 text-sm text-ink-300">{entry.titleZh}</p>
        ) : null}
        <p className="mt-2 max-w-3xl text-sm text-ink-200">{entry.summary}</p>
      </header>
      <Chart />
    </div>
  );
}
