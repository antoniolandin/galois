interface Props {
  expresion?: string;
}

// Sympy nos da expresiones tipo "alpha + x**5 - x" en un orden arbitrario.
// Reordenamos por grado descendente en x (términos x^n primero, luego x,
// luego constantes y términos en alpha) y aplicamos sustituciones
// Unicode (superíndices, α, menos tipográfico).
function pretty(expr: string): string {
  // Parsear términos firmados. Asumimos formato "term + term - term ...".
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

  // Rank: x^n → n, x → 1, alpha o constante → 0
  const rank = (t: string): number => {
    const m = t.match(/x\*\*(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (/\bx\b/.test(t)) return 1;
    return 0;
  };
  tokens.sort((a, b) => rank(b.body) - rank(a.body));

  // Re-emitir
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
    .replace(/\*\*5/g, '⁵')
    .replace(/\*\*4/g, '⁴')
    .replace(/\*\*3/g, '³')
    .replace(/\*\*2/g, '²')
    .replace(/alpha/g, 'α');
}

export function Header({ expresion }: Props) {
  return (
    <header className="header">
      <h1>Visualizador de monodromía</h1>
      {expresion && <span className="poly">P(x, α) = {pretty(expresion)}</span>}
    </header>
  );
}
