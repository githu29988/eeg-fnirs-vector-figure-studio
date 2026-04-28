import type { LinearAxis } from '../lib/scales';

interface AxisProps {
  axis: LinearAxis;
  /** Position of the axis line along the perpendicular dimension. */
  offset: number;
  /** Label rendered next to the axis (supports plain text — for LaTeX
   *  use the parent's `<foreignObject>` wrapper). */
  label?: string;
  /** Stroke colour for axis line and ticks. */
  color?: string;
  /** Optional grid extent. If provided, draw grid lines spanning this
   *  number of pixels orthogonal to the axis. */
  gridExtent?: number;
  gridColor?: string;
}

export function XAxis({
  axis,
  offset,
  label,
  color = 'currentColor',
  gridExtent,
  gridColor = 'rgba(170, 180, 200, 0.18)',
}: AxisProps) {
  const [x0, x1] = axis.range;
  return (
    <g className="axis axis-x" transform={`translate(0, ${offset})`}>
      {gridExtent
        ? axis.ticks.map((t, i) => (
            <line
              key={`grid-${i}`}
              x1={t.position}
              x2={t.position}
              y1={0}
              y2={-gridExtent}
              stroke={gridColor}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))
        : null}
      <line x1={x0} x2={x1} y1={0} y2={0} stroke={color} strokeWidth={1} />
      {axis.ticks.map((t, i) => (
        <g key={i} transform={`translate(${t.position}, 0)`}>
          <line y1={0} y2={5} stroke={color} strokeWidth={1} />
          <text
            y={18}
            textAnchor="middle"
            fontSize={11}
            fill={color}
            style={{ fontFamily: '"JetBrains Mono", monospace' }}
          >
            {t.label}
          </text>
        </g>
      ))}
      {label ? (
        <text
          x={(x0 + x1) / 2}
          y={36}
          textAnchor="middle"
          fontSize={12}
          fill={color}
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

export function YAxis({
  axis,
  offset,
  label,
  color = 'currentColor',
  gridExtent,
  gridColor = 'rgba(170, 180, 200, 0.18)',
}: AxisProps) {
  const [y0, y1] = axis.range;
  return (
    <g className="axis axis-y" transform={`translate(${offset}, 0)`}>
      {gridExtent
        ? axis.ticks.map((t, i) => (
            <line
              key={`grid-${i}`}
              x1={0}
              x2={gridExtent}
              y1={t.position}
              y2={t.position}
              stroke={gridColor}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))
        : null}
      <line x1={0} x2={0} y1={y0} y2={y1} stroke={color} strokeWidth={1} />
      {axis.ticks.map((t, i) => (
        <g key={i} transform={`translate(0, ${t.position})`}>
          <line x1={-5} x2={0} stroke={color} strokeWidth={1} />
          <text
            x={-9}
            y={4}
            textAnchor="end"
            fontSize={11}
            fill={color}
            style={{ fontFamily: '"JetBrains Mono", monospace' }}
          >
            {t.label}
          </text>
        </g>
      ))}
      {label ? (
        <text
          transform={`translate(${-44}, ${(y0 + y1) / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={12}
          fill={color}
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}
