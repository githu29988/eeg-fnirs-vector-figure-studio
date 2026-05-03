import { CATEGORIES, listCharts } from '../registry';

export function OverviewPage() {
  const charts = listCharts();
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
        工作台总览
      </p>
      <h1 className="mt-2 font-serif text-3xl leading-tight">
        从模型输出到发表级矢量图。
      </h1>
      <p className="mt-4 text-ink-200">
        脑电-近红外矢量图谱工作台（EEG-fNIRS Vector Figure Studio）是
        一套为多模态神经科学设计的可视化系统：所有二维图表皆以可
        缩放矢量图形（SVG）为原生输出，按期刊要求的高 DPI 栅格化仅作
                为后续确定性处理。坐标轴、图例与题注全面支持 LaTeX 公式。
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
                  <li className="text-ink-300">尚未注册任何图表。</li>
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
            <strong className="text-ink-50">矢量优先。</strong>
            SVG 是权威输出，栅格化导出仅在需要时启用。
          </li>
          <li>
            <strong className="text-ink-50">感知均匀色彩。</strong>仅提供
            Viridis / Magma / Cividis 等感知均匀配色，不使用 Jet 等会误导读者的色彩。
          </li>
          <li>
            <strong className="text-ink-50">LaTeX 全面支持。</strong>行内公式
            <code className="rounded bg-ink-800 px-1 font-mono text-xs">
              $\alpha_{'{i,j}'}$
            </code>
            与独立展示公式均由 KaTeX 渲染，导出时以 MathJax SVG 路径存储。
          </li>
          <li>
            <strong className="text-ink-50">演示可复现。</strong>每张图表都携带
            种子化的合成数据生成器，裁剪与截图始终稳定。
          </li>
        </ul>
      </section>
    </div>
  );
}
