# Contributing

## Setup

```bash
nvm use 22.13
npm install
npm run dev
```

## Project conventions

- **TypeScript strict mode.** No `any`. Prefer narrow type aliases
  over re-using `Record<string, unknown>`.
- **Functional React.** Hooks only. Side effects must be encapsulated
  in `useEffect`.
- **Tailwind-only styling** for app chrome. Inside SVG charts, use
  inline `style` attributes or `lib/figure.ts` theme tokens.
- **No Jet / rainbow colour ramps.** Period. Use the exports from
  `lib/colormaps.ts`.

## Pull request checklist

- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Any new chart is registered in `src/charts/index.ts` and shows up
      in the sidebar.
- [ ] Demo data is seeded (no `Math.random()` in production paths).
- [ ] Title and caption use `FigureFrame` so LaTeX rendering is
      consistent.
- [ ] If a new dependency is added, justify it in the PR description.

## Adding a chart category

If a figure doesn't fit `architecture`, `physiology`, `clinical`, or
`evaluation`, extend `CATEGORIES` in `src/registry.tsx` rather than
forcing a misclassification.
