import { CATEGORIES, listCharts } from '../registry';

export function OverviewPage() {
  const charts = listCharts();
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
        Studio Overview
      </p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">
        From model output to publication-ready vector figures.
      </h1>
      <p className="mt-4 text-ink-200">
        EEG-fNIRS Vector Figure Studio is an opinionated visualisation
        system for multimodal neuroscience. Every 2D figure is rendered
        as scalable vector graphics first; raster export at journal-grade
        DPI is a deterministic post-process. LaTeX is treated as a
        first-class citizen across axis labels, legends, and captions.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CATEGORIES.filter((c) => c.id !== 'overview').map((cat) => {
          const items = charts.filter((c) => c.category === cat.id);
          return (
            <section
              key={cat.id}
              className="rounded-lg border border-ink-700 bg-ink-900 p-4"
            >
              <h2 className="text-sm font-semibold text-ink-50">{cat.label}</h2>
              {cat.description ? (
                <p className="mt-1 text-xs text-ink-300">{cat.description}</p>
              ) : null}
              <ul className="mt-3 space-y-1 text-xs text-ink-100">
                {items.length === 0 ? (
                  <li className="text-ink-300">No charts registered yet.</li>
                ) : (
                  items.map((c) => (
                    <li key={c.id}>
                      <a
                        className="hover:text-accent"
                        href={`#/chart/${c.id}`}
                      >
                        {c.title}
                      </a>
                    </li>
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-10 rounded-lg border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-semibold text-ink-50">Design principles</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-200">
          <li>
            <strong className="text-ink-50">Vector first.</strong> SVG is the
            authoritative output; raster is opt-in.
          </li>
          <li>
            <strong className="text-ink-50">Perceptually uniform colour.</strong>{' '}
            Viridis, Magma, Cividis and friends — never Jet.
          </li>
          <li>
            <strong className="text-ink-50">LaTeX everywhere.</strong> Inline{' '}
            <code className="rounded bg-ink-800 px-1 font-mono text-xs">
              $\alpha_{'{i,j}'}$
            </code>{' '}
            and display equations render through KaTeX.
          </li>
          <li>
            <strong className="text-ink-50">Reproducible demos.</strong> Every
            figure ships with seeded synthetic data so screenshots stay stable.
          </li>
        </ul>
      </section>
    </div>
  );
}
