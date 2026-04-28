import { forwardRef, useEffect, useRef } from 'react';
import { renderInlineLatex } from '../lib/latex';

interface FigureFrameProps {
  title?: string;
  caption?: string;
  width: number;
  height: number;
  /** Padding around the inner figure for title/caption. */
  framePadding?: { top: number; bottom: number };
  children: React.ReactNode;
}

/**
 * A thin SVG wrapper that renders a figure title and caption with
 * KaTeX-rendered LaTeX (via `<foreignObject>`) and a clip region for
 * the chart body. Charts mount as children of this frame.
 */
export const FigureFrame = forwardRef<SVGSVGElement, FigureFrameProps>(
  function FigureFrame(
    { title, caption, width, height, framePadding, children },
    ref,
  ) {
    const titleRef = useRef<HTMLDivElement>(null);
    const captionRef = useRef<HTMLDivElement>(null);

    const padTop = framePadding?.top ?? (title ? 28 : 0);
    const padBottom = framePadding?.bottom ?? (caption ? 32 : 0);

    useEffect(() => {
      if (titleRef.current && title) {
        titleRef.current.innerHTML = renderInlineLatex(title);
      }
      if (captionRef.current && caption) {
        captionRef.current.innerHTML = renderInlineLatex(caption);
      }
    }, [title, caption]);

    return (
      <svg
        ref={ref}
        className="figure-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {title ? (
          <foreignObject x={0} y={4} width={width} height={padTop}>
            <div
              ref={titleRef}
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 14,
                fontWeight: 600,
                color: 'currentColor',
                textAlign: 'center',
              }}
            />
          </foreignObject>
        ) : null}

        <g transform={`translate(0, ${padTop})`}>{children}</g>

        {caption ? (
          <foreignObject
            x={0}
            y={height - padBottom}
            width={width}
            height={padBottom}
          >
            <div
              ref={captionRef}
              style={{
                fontFamily: '"Crimson Pro", "Times New Roman", serif',
                fontSize: 12,
                fontStyle: 'italic',
                color: 'currentColor',
                opacity: 0.85,
                textAlign: 'center',
                paddingTop: 8,
              }}
            />
          </foreignObject>
        ) : null}
      </svg>
    );
  },
);
