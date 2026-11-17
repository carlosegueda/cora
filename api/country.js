// Función de Vercel: devuelve el país del visitante según su IP, usando la cabecera que pone
// el propio Vercel (x-vercel-ip-country). No llama a ningún servicio externo ni guarda la IP.
// El juego la usa para mostrar la bandera del jugador en la tabla del modo Diario.
export function GET(request) {
  const code = request.headers.get('x-vercel-ip-country');
  const country = code && /^[A-Z]{2}$/.test(code) ? code : null;
  return new Response(JSON.stringify({ country }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
