import katex from 'katex';
import 'katex/dist/katex.min.css';
import { memo, useMemo } from 'react';

interface Props {
  tex: string;
  display?: boolean;
}

// Render LaTeX inline (`display=false`) o bloque centrado (`display=true`).
// Wrapper sobre katex.renderToString memoizado para que re-renders del
// padre con el mismo `tex` no triggeen un nuevo objeto en
// `dangerouslySetInnerHTML`, que causa re-mount del HTML interno y
// dispara CSS animations de KaTeX otra vez.
function MathRaw({ tex, display = false }: Props) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        throwOnError: false,
        displayMode: display,
        output: 'html',
        strict: 'ignore',
        trust: true,
      }),
    [tex, display],
  );
  // Memoizamos el objeto literal: si `html` no cambió, React no
  // detecta diff y no re-aplica el innerHTML.
  const danger = useMemo(() => ({ __html: html }), [html]);
  return (
    <span
      className={display ? 'katex-display-wrap' : 'katex-inline-wrap'}
      dangerouslySetInnerHTML={danger}
    />
  );
}

export const Math = memo(MathRaw);
