// Used by the screens someone waits on while signing in. It notices the moment they are
// signed in, by whichever route that happened, and moves them on.
import { router } from 'expo-router';
import { useEffect } from 'react';

import { arrive } from '@/lib/arrive';
import { collect, useSession } from '@/state/session';

export function useLinkWatch() {
  const status = useSession((s) => s.status);
  useEffect(() => {
    if (status === 'in') {
      arrive();
      return;
    }
    if (status !== 'out') return;
    let stopped = false;
    const look = async () => {
      const result = await collect().catch(() => null);
      if (stopped || !result) return;
      if (result === 'expired') router.replace('/link-expired');
      // 'in' flips the status, and the lines above move on.
    };
    look();
    const again = setInterval(look, 2500);
    return () => {
      stopped = true;
      clearInterval(again);
    };
  }, [status]);
}
