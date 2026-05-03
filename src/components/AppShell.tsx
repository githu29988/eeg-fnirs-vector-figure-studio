import { NavLink, Outlet } from 'react-router-dom';
import { CATEGORIES, listCharts } from '../registry';

export function AppShell() {
  const charts = listCharts();
  return (
    <div className="grid h-full grid-cols-[280px_1fr] bg-ink-950 text-ink-100">
      <aside className="flex h-full flex-col border-r border-ink-700 bg-ink-900">
        <header className="border-b border-ink-700 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
            脑电 · 近红外
          </p>
          <h1 className="mt-1 font-serif text-lg leading-tight">
            矢量图谱工作台
          </h1>
          <p className="mt-1 text-xs text-ink-300">
            多模态神经科学发表级矢量图表。
          </p>
        </header>

        <nav className="flex-1 overflow-y-auto px-2 py-3 text-sm">
          <NavItem to="/" exact label="总览" />
          {CATEGORIES.filter((c) => c.id !== 'overview').map((cat) => {
            const items = charts.filter((c) => c.category === cat.id);
            if (items.length === 0) return null;
            return (
              <section key={cat.id} className="mt-4">
                <p className="px-2 text-[11px] uppercase tracking-[0.18em] text-ink-300">
                  {cat.label}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {items.map((item) => (
                    <li key={item.id}>
                      <NavItem
                        to={`/chart/${item.id}`}
                        label={item.title}
                        sublabel={item.titleEn}
                        wip={item.status === 'wip'}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </nav>

        <footer className="border-t border-ink-700 p-3 text-[11px] text-ink-300">
          <p>v0.1.0 · MVP版</p>
        </footer>
      </aside>

      <main className="h-full overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({
  to,
  exact,
  label,
  sublabel,
  wip,
}: {
  to: string;
  exact?: boolean;
  label: string;
  sublabel?: string;
  wip?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        [
          'block rounded px-2 py-1.5 leading-tight transition',
          isActive
            ? 'bg-ink-700 text-ink-50'
            : 'text-ink-100 hover:bg-ink-800 hover:text-ink-50',
        ].join(' ')
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        {wip ? (
          <span className="rounded bg-accent-warm/15 px-1 text-[10px] font-medium text-accent-warm">
            开发中
          </span>
        ) : null}
      </div>
      {sublabel ? (
        <div className="truncate text-[11px] text-ink-300">{sublabel}</div>
      ) : null}
    </NavLink>
  );
}
