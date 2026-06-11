import { useEffect, useRef, useState } from 'react';

interface Props {
  expresion?: string;
  // Callback que pide al backend cambiar el polinomio. Si la
  // promesa rechaza, el header muestra el mensaje y mantiene el
  // input abierto para que el usuario lo corrija.
  onChangeExpresion?: (expresion: string) => Promise<void>;
  // Callback para volver a la landing.
  onGoHome?: () => void;
  // Callback para cambiar a la vista de Stauduhar (cuerpos de numeros).
  onGoToStauduhar?: () => void;
}

// Sympy nos da expresiones tipo "alpha + x**5 - x" en un orden arbitrario.
// Reordenamos por grado descendente en x (términos x^n primero, luego x,
// luego constantes y términos en alpha) y aplicamos sustituciones
// Unicode (superíndices, α, menos tipográfico).
function pretty(expr: string): string {
  const tokens: { sign: '+' | '-'; body: string }[] = [];
  let sign: '+' | '-' = '+';
  let buf = '';
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if ((c === '+' || c === '-') && buf.trim()) {
      tokens.push({ sign, body: buf.trim() });
      sign = c as '+' | '-';
      buf = '';
    } else if (c === '+' || c === '-') {
      sign = c as '+' | '-';
    } else {
      buf += c;
    }
  }
  if (buf.trim()) tokens.push({ sign, body: buf.trim() });

  const rank = (t: string): number => {
    const m = t.match(/x\*\*(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (/\bx\b/.test(t)) return 1;
    return 0;
  };
  tokens.sort((a, b) => rank(b.body) - rank(a.body));

  let out = '';
  tokens.forEach((tok, i) => {
    if (i === 0) {
      if (tok.sign === '-') out += '−';
    } else {
      out += tok.sign === '+' ? ' + ' : ' − ';
    }
    out += tok.body;
  });

  return out
    .replace(/\*\*(\d+)/g, (_, d: string) =>
      d
        .split('')
        .map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[parseInt(c, 10)])
        .join(''),
    )
    .replace(/alpha/g, 'α');
}

// Validación local de lo que el usuario escribe. Devuelve el string
// normalizado (sin α y sin `^`, listo para enviar al backend) si
// pasa, o un mensaje de error en caso contrario. No comprueba que
// sea un polinomio válido en x — eso lo hace el backend con sympy.
function validar(
  expr: string,
): { ok: true; expr: string } | { ok: false; error: string } {
  // Normalización:
  //   · α       → alpha
  //   · `a` aislada (no parte de `alpha`) → alpha
  //   · ^       → ** (sympy admite cualquiera de las dos)
  // El `\ba\b` no pisa "alpha" porque dentro de esa palabra la `a`
  // no está rodeada de word boundaries (al lado tiene `l`).
  const norm = expr
    .replace(/α/g, 'alpha')
    .replace(/\ba\b/g, 'alpha')
    .replace(/\^/g, '**')
    .trim();
  if (norm.length === 0) return { ok: false, error: 'Expresión vacía' };
  if (!/\bx\b/.test(norm)) return { ok: false, error: 'Falta la variable x' };
  if (!/\balpha\b/.test(norm))
    return { ok: false, error: 'Falta la variable α' };
  return { ok: true, expr: norm };
}

export function Header({ expresion, onChangeExpresion, onGoHome, onGoToStauduhar }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function startEdit() {
    if (!onChangeExpresion || enviando) return;
    setValue(expresion ?? '');
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function submit() {
    if (!onChangeExpresion) return;
    const r = validar(value);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await onChangeExpresion(r.expr);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <header className="header">
      {onGoHome && (
        <button
          className="btn-back"
          onClick={onGoHome}
          title="Volver a la página de inicio"
        >
          ← Inicio
        </button>
      )}
      <h1>Visualizador de monodromía</h1>
      {editing ? (
        <div className="poly-edit">
          <input
            ref={inputRef}
            className={'poly-input' + (error ? ' poly-input-error' : '')}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') cancelEdit();
            }}
            onBlur={() => {
              // Si se pierde el foco sin Enter, cancelamos. Si está
              // enviando, no tocamos.
              if (!enviando) cancelEdit();
            }}
            placeholder="x^5 - x + alpha"
            disabled={enviando}
            spellCheck={false}
          />
          {error && (
            <span className="poly-error" title={error}>
              {error}
            </span>
          )}
        </div>
      ) : expresion ? (
        <span
          className={'poly' + (onChangeExpresion ? ' poly-editable' : '')}
          title={
            onChangeExpresion ? 'Click para cambiar el polinomio' : undefined
          }
          onClick={startEdit}
        >
          P(x, α) = {pretty(expresion)}
        </span>
      ) : null}
      {onGoToStauduhar && (
        <button
          className="btn-stauduhar"
          onClick={onGoToStauduhar}
          title="Modo Stauduhar sobre cuerpos de números"
        >
          Stauduhar →
        </button>
      )}
    </header>
  );
}
