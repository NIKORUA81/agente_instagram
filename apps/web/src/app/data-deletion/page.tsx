export const metadata = { title: 'Eliminación de datos — WOLFIAX SOCIAL AI' };

export default function DataDeletionPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-bold tracking-tight">
        WOLFIAX <span className="text-brand-600">SOCIAL AI</span>
      </p>
      <h1 className="mt-6 text-2xl font-semibold">Instrucciones para eliminar tus datos</h1>
      <p className="mt-1 text-sm text-neutral-500">Última actualización: julio de 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-neutral-700">
        <p>
          Puedes solicitar la eliminación completa de los datos que WOLFIAX SOCIAL AI conserva sobre
          tu cuenta de Instagram y las conversaciones asociadas en cualquier momento, por cualquiera
          de estas dos vías:
        </p>

        <section>
          <h2 className="font-semibold text-neutral-900">1. Desde el panel</h2>
          <p className="mt-2">
            Inicia sesión en <span className="font-medium">app.wolfiax.com</span> → Canales →
            selecciona la cuenta → <span className="font-medium">Desconectar</span>. Esto revoca
            nuestro acceso inmediatamente. Para el borrado definitivo del historial de conversaciones,
            usa la vía de correo (punto 2).
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-neutral-900">2. Por correo</h2>
          <p className="mt-2">
            Escribe a{' '}
            <a href="mailto:ceo@wolfiax.com?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos" className="text-brand-600 underline">
              ceo@wolfiax.com
            </a>{' '}
            desde el correo asociado a tu cuenta, indicando el usuario de Instagram (@usuario) cuya
            información quieres eliminar. Confirmaremos la solicitud y eliminaremos de forma
            permanente:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>El token de acceso cifrado y la conexión del canal.</li>
            <li>El historial de conversaciones, contactos y mensajes asociados a esa cuenta.</li>
            <li>Cualquier dato extraído o generado por la IA sobre esos contactos.</li>
          </ul>
          <p className="mt-2">
            Procesamos las solicitudes dentro de los 30 días siguientes a la confirmación, según lo
            exigen las políticas de la plataforma de Meta.
          </p>
        </section>
      </div>
    </div>
  );
}
