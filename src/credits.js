// Botón (i) y popup de créditos. El contenido está en index.html (#info-dialog).
// Se cierra con la ✕, con la tecla Esc (lo hace el propio <dialog>) o haciendo clic fuera.
export function setupCredits() {
  const button = document.getElementById('info-button');
  const dialog = document.getElementById('info-dialog');

  button.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());

  // Un clic en el fondo oscuro llega al propio <dialog> (fuera de su recuadro): se cierra
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dialog.close();
  });
}
