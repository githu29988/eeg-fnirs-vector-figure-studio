import { useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
} from '../../components/Controls';
import { getColormap, type ColormapName } from '../../lib/colormaps';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import {
  activationAt,
  buildBrainMesh,
  DEFAULT_HOTSPOTS,
  rotate,
  type Vec3,
} from './mesh';

interface ProjectedTri {
  points: string;
  fill: string;
  meanZ: number;
  shade: number;
}

function CorticalChart() {
  const [yaw, setYaw] = useState(0.6);
  const [pitch, setPitch] = useState(0.25);
  const [colormap, setColormap] = useState<ColormapName>('inferno');
  const [opacity, setOpacity] = useState(0.95);
  const [meshLat, setMeshLat] = useState(48);
  const [meshLong, setMeshLong] = useState(30);
  const svgRef = useRef<SVGSVGElement>(null);

  const mesh = useMemo(() => buildBrainMesh(meshLat, meshLong), [meshLat, meshLong]);

  const expertSchema: ExpertSchema = [
    {
      label: '视角',
      fields: [
        { type: 'number', key: 'yaw', label: '偏航角', min: -Math.PI, max: Math.PI, step: 0.02, value: yaw, onChange: setYaw, slider: true, format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°` },
        { type: 'number', key: 'pitch', label: '仰俯角', min: -1.2, max: 1.2, step: 0.01, value: pitch, onChange: setPitch, slider: true, format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°` },
      ],
    },
    {
      label: '网格',
      description: '程序化生成的皮层表面细分密度。',
      fields: [
        { type: 'number', key: 'mlat', label: '经度分段数', min: 16, max: 96, step: 2, value: meshLat, onChange: setMeshLat, slider: true },
        { type: 'number', key: 'mlong', label: '纬度分段数', min: 12, max: 60, step: 2, value: meshLong, onChange: setMeshLong, slider: true },
      ],
    },
    {
      label: '渲染',
      fields: [
        { type: 'number', key: 'op', label: '不透明度', min: 0.1, max: 1, step: 0.01, value: opacity, onChange: setOpacity, slider: true, format: (v) => v.toFixed(2) },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
  ];
  const hotspots = DEFAULT_HOTSPOTS;
  const interp = getColormap(colormap);

  const W = 720;
  const H = 540;
  const cx = W / 2;
  const cy = H / 2 - 16;
  const scale = 200;
  // Light direction in object space.
  const light: Vec3 = { x: -0.5, y: 0.7, z: 0.5 };
  const lightLen = Math.hypot(light.x, light.y, light.z);
  const ln: Vec3 = {
    x: light.x / lightLen,
    y: light.y / lightLen,
    z: light.z / lightLen,
  };

  const triangles = useMemo<ProjectedTri[]>(() => {
    const rot = { yaw, pitch };
    const projected: Vec3[] = mesh.vertices.map((v) => rotate(v, rot));
    const acts = mesh.vertices.map((v) => activationAt(v, hotspots));
    const maxAct = Math.max(...acts, 1e-6);

    const tris: ProjectedTri[] = [];
    for (const t of mesh.triangles) {
      const pa = projected[t.a];
      const pb = projected[t.b];
      const pc = projected[t.c];
      // Backface cull: skip triangles whose surface normal points away.
      const ux = pb.x - pa.x;
      const uy = pb.y - pa.y;
      const uz = pb.z - pa.z;
      const vx = pc.x - pa.x;
      const vy = pc.y - pa.y;
      const vz = pc.z - pa.z;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      if (nz < 0) continue;
      const nlen = Math.hypot(nx, ny, nz) || 1;
      const dot = (nx * ln.x + ny * ln.y + nz * ln.z) / nlen;
      const shade = Math.max(0.4, 0.4 + 0.6 * dot);

      const ax = cx + pa.x * scale;
      const ay = cy - pa.y * scale;
      const bx = cx + pb.x * scale;
      const by = cy - pb.y * scale;
      const cx2 = cx + pc.x * scale;
      const cy2 = cy - pc.y * scale;
      const meanZ = (pa.z + pb.z + pc.z) / 3;

      const meanAct = (acts[t.a] + acts[t.b] + acts[t.c]) / (3 * maxAct);
      const baseFill = interp(meanAct);
      tris.push({
        points: `${ax},${ay} ${bx},${by} ${cx2},${cy2}`,
        fill: baseFill,
        meanZ,
        shade,
      });
    }
    tris.sort((a, b) => a.meanZ - b.meanZ);
    return tris;
  }, [mesh, hotspots, yaw, pitch, interp, cx, cy, scale, ln.x, ln.y, ln.z]);

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'left',
              label: '左侧面观',
              hint: '矢状面',
              description: '偏航角 ≈ −π/2 — 经典图谱朝向。',
              apply: () => {
                setYaw(-Math.PI / 2);
                setPitch(0.05);
              },
            },
            {
              id: 'top',
              label: '顶视俯视',
              hint: '轴向面',
              description: '从上方直视皮层。',
              apply: () => {
                setYaw(0);
                setPitch(Math.PI / 2 - 0.05);
              },
            },
            {
              id: 'oblique',
              label: '斜 3/4 视角',
              hint: '插图',
              description: '偏航 0.6、仰俯 0.25 — 发表默认。',
              apply: () => {
                setYaw(0.6);
                setPitch(0.25);
                setOpacity(0.95);
              },
            },
            {
              id: 'dense',
              label: '高密网格',
              hint: '导出',
              description: '高面数，使 PDF 放大仍清晰。',
              apply: () => {
                setMeshLat(64);
                setMeshLong(40);
              },
            },
          ]}
        />
      }
      filename="cortical-3d"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="视角">
            <NumberSlider
              label="偏航角"
              value={yaw}
              min={-Math.PI}
              max={Math.PI}
              step={0.05}
              onChange={setYaw}
              format={(v) => `${((v * 180) / Math.PI).toFixed(0)}°`}
            />
            <NumberSlider
              label="仰俯角"
              value={pitch}
              min={-1}
              max={1}
              step={0.02}
              onChange={setPitch}
              format={(v) => `${((v * 180) / Math.PI).toFixed(0)}°`}
            />
          </ControlGroup>
          <ControlGroup label="渲染">
            <NumberSlider
              label="不透明度"
              value={opacity}
              min={0.4}
              max={1}
              step={0.02}
              onChange={setOpacity}
              format={(v) => v.toFixed(2)}
            />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          程序化生成的皮层表面，以深度排序的 SVG 三角形渲染（画家算法）。
          顶点激活来自三个高斯热点；表面采用 Lambertian 光照模型，
          使类似脑回的起伏仍可讀。输出为纯矢量 — 不依赖 canvas / WebGL
          — 因此 SVG 导出无损。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title="3.5D cortical projection · vertex activation"
          caption="Procedural brain mesh with Lambertian shading and perceptually uniform colour."
        >
          {triangles.map((t, i) => (
            <polygon
              key={i}
              points={t.points}
              fill={t.fill}
              fillOpacity={opacity}
              stroke={t.fill}
              strokeOpacity={opacity * 0.4}
              strokeWidth={0.5}
              style={{ filter: `brightness(${t.shade.toFixed(3)})` }}
            />
          ))}

          {/* Color bar */}
          <g transform={`translate(${W - 80}, 80)`}>
            {Array.from({ length: 32 }).map((_, k) => {
              const t = k / 31;
              return (
                <rect
                  key={k}
                  x={0}
                  y={(1 - t) * 320 - 10}
                  width={14}
                  height={11}
                  fill={interp(t)}
                />
              );
            })}
            <rect x={0} y={0} width={14} height={320} fill="none" stroke="#0d1117" strokeOpacity={0.4} />
            {[0, 0.5, 1].map((t) => (
              <text
                key={t}
                x={20}
                y={(1 - t) * 320 + 4}
                fontSize={10}
                fontFamily='"JetBrains Mono", monospace'
                fill="#0d1117"
              >
                {t.toFixed(1)}
              </text>
            ))}
            <text
              transform={`translate(54, 160) rotate(-90)`}
              textAnchor="middle"
              fontSize={11}
              fill="#0d1117"
            >
              Activation
            </text>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'cortical-3d',
  title: '3.5D 皮层投影热力图',
  titleEn: '3.5D Cortical Projection',
  category: 'physiology',
  summary: '程序化生成的大脑网格以深度排序的 SVG 三角形渲染，按顶点激活上色。',
  component: CorticalChart,
});
