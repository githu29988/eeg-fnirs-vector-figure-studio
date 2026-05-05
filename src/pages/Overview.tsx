import { CATEGORIES, listCharts } from '../registry';

export function OverviewPage() {
  const charts = listCharts();
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
        工作室概览
      </p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">
        从模型输出直达出版级矢量图。
      </h1>
      <p className="mt-4 text-ink-200">
        EEG-fNIRS 矢量图表工作室是一套面向多模态神经科学的可视化体系。所有
        2D 图形优先以可缩放矢量图(SVG)渲染;期刊级 DPI 的位图导出由确定性后
        处理生成。LaTeX 在坐标轴标签、图例与题注中均作为一等公民对待。
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
                  <li className="text-ink-300">暂无已注册的图表。</li>
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
        <h2 className="text-sm font-semibold text-ink-50">设计原则</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-200">
          <li>
            <strong className="text-ink-50">矢量优先。</strong> SVG 是权威输出,
            位图为可选项。
          </li>
          <li>
            <strong className="text-ink-50">感知均匀的配色。</strong>{' '}
            Viridis、Magma、Cividis 等 — 永不使用 Jet。
          </li>
          <li>
            <strong className="text-ink-50">全程 LaTeX。</strong> 行内{' '}
            <code className="rounded bg-ink-800 px-1 font-mono text-xs">
              $\alpha_{'{i,j}'}$
            </code>{' '}
            与块级公式均通过 KaTeX 渲染。
          </li>
          <li>
            <strong className="text-ink-50">可复现示例。</strong>{' '}
            每张图均自带带种子的合成数据,确保截图稳定可重现。
          </li>
        </ul>
      </section>
    </div>
  );
}
