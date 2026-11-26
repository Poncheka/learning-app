// The listener's first name and picture, shown in the badge at the top of the main screens.
import { create } from 'zustand';

import { getProfile, setAvatar, setFirstName, type Profile } from '@/lib/api';

type ProfileState = Profile & {
  loaded: boolean;
  load: () => Promise<Profile | null>;
  rename: (name: string) => Promise<void>;
  changePicture: (localUri: string) => Promise<void>;
  forget: () => void;
};

export const useProfile = create<ProfileState>((set) => ({
  first_name: null,
  avatar_url: null,
  loaded: false,
  load: async () => {
    try {
      const profile = await getProfile();
      set({ ...profile, loaded: true });
      return profile;
    } catch {
      set({ loaded: true });
      return null;
    }
  },
  rename: async (name) => set({ ...(await setFirstName(name)), loaded: true }),
  changePicture: async (localUri) => set({ ...(await setAvatar(localUri)), loaded: true }),
  forget: () => set({ first_name: null, avatar_url: null, loaded: false }),
}));
