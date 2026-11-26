// Where someone goes once a sign-in link has done its work.
import { router } from 'expo-router';

import { getInterests } from '@/lib/api';
import { useProfile } from '@/state/profile';

/**
 * Someone without a name is asked for one first, then a new person picks interests. Everyone else
 * goes to Listen. A name is asked of people who signed up before names were, the next time they arrive.
 */
export async function arrive() {
  const [profile, fresh] = await Promise.all([
    useProfile.getState().load(),
    getInterests()
      .then((data) => data.interests.length === 0)
      .catch(() => false),
  ]);
  // If the profile could not be read, nobody is stopped: the name is asked another time.
  if (profile && !profile.first_name) return router.replace('/your-name');
  router.replace(fresh ? '/first-interests' : '/listen');
}
