import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';

interface Props {
  tex: string;
  display?: boolean;
}

// Render LaTeX inline (`display=false`) o bloque centrado (`display=true`).
// Wrapper minimo sobre katex.renderToString para que el frontend pueda
// embeber expresiones simbolicas devueltas por el backend (factorizaciones
// sobre Q, polinomios resolventes, etc.) sin instalar react-katex.
export function Math({ tex, display = false }: Props) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        throwOnError: false,
        displayMode: display,
        output: 'html',
        strict: 'ignore',
      }),
    [tex, display],
  );
  return (
    <span
      className={display ? 'katex-display-wrap' : 'katex-inline-wrap'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
