'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Spinner } from '@/components/ui/spinner';

/** Raíz: redirige según el estado de sesión. */
export default function Home() {
  const { me } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (me === undefined) return;
    router.replace(me ? '/dashboard' : '/login');
  }, [me, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}
