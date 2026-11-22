// Where someone goes once a sign-in link has done its work.
import { router } from 'expo-router';

import { getInterests } from '@/lib/api';

/** A new person picks interests first. Everyone else goes to Listen. */
export async function arrive() {
  const fresh = await getInterests()
    .then((data) => data.interests.length === 0)
    .catch(() => false);
  router.replace(fresh ? '/first-interests' : '/listen');
}
