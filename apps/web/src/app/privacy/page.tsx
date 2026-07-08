export const metadata = { title: 'Política de privacidad — WOLFIAX SOCIAL AI' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-bold tracking-tight">
        WOLFIAX <span className="text-brand-600">SOCIAL AI</span>
      </p>
      <h1 className="mt-6 text-2xl font-semibold">Política de privacidad</h1>
      <p className="mt-1 text-sm text-neutral-500">Última actualización: julio de 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-neutral-700">
        <p>
          WOLFIAX SOCIAL AI ("Wolfiax", "nosotros") ofrece software de automatización de mensajería
          para cuentas profesionales de Instagram, usando exclusivamente las APIs oficiales de Meta.
          Esta política describe qué datos tratamos y cómo, cuando conectas tu cuenta de Instagram o
          Facebook a nuestra plataforma.
        </p>

        <section>
          <h2 className="font-semibold text-neutral-900">Qué datos recibimos de Meta</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Identificador y nombre de usuario de tu cuenta de Instagram profesional.</li>
            <li>Los mensajes directos, respuestas a historias y reacciones que tu cuenta recibe o envía.</li>
            <li>Metadatos de la cuenta necesarios para operar (foto de perfil, si sigue al negocio).</li>
            <li>El token de acceso que autoriza a nuestra app a leer y enviar mensajes en tu nombre.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-neutral-900">Cómo protegemos estos datos</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Los tokens de acceso se cifran en reposo (AES-256-GCM) y nunca se muestran en logs.</li>
            <li>Toda la comunicación viaja cifrada por TLS.</li>
            <li>
              Cada organización (tenant) tiene sus datos completamente aislados a nivel de base de
              datos (Row-Level Security); ninguna organización puede leer datos de otra.
            </li>
            <li>No vendemos ni compartimos tus datos con terceros para publicidad.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-neutral-900">Para qué usamos los datos</h2>
          <p className="mt-2">
            Únicamente para operar el servicio que contrataste: mostrar tus conversaciones en el
            panel, responder automáticamente dentro de la ventana de 24 horas que permite Meta,
            generar respuestas con inteligencia artificial usando la base de conocimiento que tú
            mismo cargas, y análisis agregado de uso de tu propia cuenta.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-neutral-900">Retención y eliminación</h2>
          <p className="mt-2">
            Conservamos los datos mientras tu cuenta permanezca conectada. Puedes desconectar tu
            cuenta de Instagram en cualquier momento desde el panel (Canales → Desconectar), lo que
            revoca nuestro acceso. Para solicitar la eliminación completa de tus datos, consulta{' '}
            <a href="/data-deletion" className="text-brand-600 underline">
              instrucciones de eliminación de datos
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-neutral-900">Contacto</h2>
          <p className="mt-2">
            Para cualquier consulta sobre esta política o tus datos, escríbenos a{' '}
            <a href="mailto:ceo@wolfiax.com" className="text-brand-600 underline">
              ceo@wolfiax.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
