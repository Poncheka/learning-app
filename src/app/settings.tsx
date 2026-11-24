// Settings. For now, one choice: who reads the lessons.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Em, Eyebrow, Icon, OutlineButton, RoundButton, Screen, Serif, Wordmark } from '@/components/ui';
import { forgetInterests } from '@/app/interests';
import { usePlayer } from '@/state/player';
import { useTopics } from '@/state/topics';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

export default function Settings() {
  const email = useSession((s) => s.email);

  // Signing out stops whatever is playing. The root layout then shows the sign-in screen.
  const signOut = () => {
    usePlayer.getState().stop();
    // Nothing of this person's is left on screen for whoever signs in next.
    useTopics.setState({ topics: [], selected: null, error: null, fresh: [] });
    forgetInterests();
    useSession.getState().signOut();
  };

  return (
    <Screen>
      <View style={styles.top}>
        <RoundButton label="Back" onPress={() => router.back()}>
          <Icon name="back" size={22} />
        </RoundButton>
        <Wordmark />
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Serif style={{ marginTop: 18, marginBottom: 6 }}>
          Your <Em>account.</Em>
        </Serif>

        <Eyebrow style={{ marginTop: 26, marginBottom: 10 }}>Account</Eyebrow>
        <Text style={styles.account}>{email ? `Signed in as ${email}` : 'Signed in'}</Text>
        <OutlineButton label="Sign out" onPress={signOut} style={{ alignSelf: 'flex-start', marginTop: 12 }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lead: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.gray, marginTop: 10, marginBottom: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76, paddingVertical: 12, paddingHorizontal: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white, marginBottom: 10 },
  rowOn: { backgroundColor: colors.yellow },
  name: { fontFamily: fonts.bodySemi, fontSize: 18, color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.gray, marginTop: 2 },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  markOn: { backgroundColor: colors.ink },
  error: { fontFamily: fonts.body, fontSize: 14, color: colors.vermilion, marginTop: 6 },
  account: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
});
