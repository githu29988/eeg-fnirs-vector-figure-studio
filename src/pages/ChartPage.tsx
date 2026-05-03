import { useParams, Link } from 'react-router-dom';
import { CATEGORIES, findChart } from '../registry';

export function ChartPage() {
  const { id } = useParams<{ id: string }>();
  const entry = id ? findChart(id) : undefined;

  if (!entry) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-16 text-center">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
          404
        </p>
        <h1 className="mt-2 font-serif text-3xl">图表未找到</h1>
        <p className="mt-3 text-ink-300">
          标识 <code className="font-mono">{id}</code> 不在注册表中。
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded border border-ink-600 bg-ink-800 px-4 py-2 text-sm hover:border-accent hover:text-accent"
        >
          返回概览
        </Link>
      </div>
    );
  }

  const Chart = entry.component;
  const category = CATEGORIES.find((c) => c.id === entry.category);
  return (
    <div className="px-8 py-8">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
          {category?.label ?? entry.category}
        </p>
        <h1 className="mt-1 font-serif text-2xl leading-tight">
          {entry.title}
        </h1>
        {entry.titleEn ? (
          <p className="mt-1 text-sm text-ink-300">{entry.titleEn}</p>
        ) : null}
        <p className="mt-2 max-w-3xl text-sm text-ink-200">{entry.summary}</p>
      </header>
      <Chart />
    </div>
  );
}
