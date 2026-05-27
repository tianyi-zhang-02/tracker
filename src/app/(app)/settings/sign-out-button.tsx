'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch('/api/auth/signout', { method: 'POST' });
        router.replace('/login');
        router.refresh();
      }}
      className="border-border text-muted hover:bg-foreground/5 hover:text-foreground self-start rounded border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
