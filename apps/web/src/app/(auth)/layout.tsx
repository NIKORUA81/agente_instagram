export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <p className="text-2xl font-bold tracking-tight text-neutral-900">
          WOLFIAX <span className="text-brand-600">SOCIAL AI</span>
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Automatización inteligente de DMs de Instagram
        </p>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
