// Your profile, opened from the badge at the top right of the main screens: your picture, the name
// Pliny calls you and friends see on stories you send, your interests, and signing out.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/ProfileBadge';
import { Em, Eyebrow, Icon, OutlineButton, RoundButton, Screen, Serif, Wordmark } from '@/components/ui';
import { forgetInterests } from '@/app/interests';
import { usePlayer } from '@/state/player';
import { useProfile } from '@/state/profile';
import { useTopics } from '@/state/topics';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

// Choosing a picture needs a part of the app that older installs do not have. On those, the
// option is not offered, and nothing else changes.
type Picker = typeof import('expo-image-picker');
let picker: Picker | null = null;
try {
  picker = require('expo-image-picker') as Picker;
} catch {
  picker = null;
}

export default function Settings() {
  const email = useSession((s) => s.email);
  const { first_name, loaded, load, rename, changePicture } = useProfile();
  const [name, setName] = useState(first_name ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) load().then((p) => p?.first_name && setName(p.first_name));
  }, [loaded, load]);
  useEffect(() => {
    if (first_name) setName((now) => now || first_name);
  }, [first_name]);

  const changed = name.trim().length > 0 && name.trim() !== (first_name ?? '');
  const saveName = async () => {
    if (!changed || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    setError(null);
    try {
      await rename(name.trim());
      setNote('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save. Try again.');
    }
    setSaving(false);
  };

  const pickPicture = async () => {
    if (!picker || uploading) return;
    setError(null);
    const allowed = await picker.requestMediaLibraryPermissionsAsync();
    if (!allowed.granted) return setError('Pliny needs access to your photos to set a picture. You can allow it in Settings.');
    const chosen = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (chosen.canceled || !chosen.assets?.[0]?.uri) return;
    setUploading(true);
    try {
      await changePicture(chosen.assets[0].uri);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The picture did not upload. Try again.');
    }
    setUploading(false);
  };

  // Signing out stops whatever is playing. The root layout then shows the sign-in screen.
  const signOut = () => {
    usePlayer.getState().stop();
    // Nothing of this person's is left on screen for whoever signs in next.
    useTopics.setState({ topics: [], selected: null, error: null, fresh: [] });
    forgetInterests();
    useProfile.getState().forget();
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <Serif style={{ marginTop: 18, marginBottom: 20 }}>
            Your <Em>profile.</Em>
          </Serif>

          <View style={styles.pictureRow}>
            <View>
              <Avatar size={96} />
              {uploading ? (
                <View style={styles.uploading}>
                  <ActivityIndicator color={colors.ink} />
                </View>
              ) : null}
            </View>
            {picker ? (
              <OutlineButton label={uploading ? 'Uploading' : 'Change photo'} height={44} textSize={15} onPress={pickPicture} style={{ paddingHorizontal: 18 }} />
            ) : (
              <Text style={styles.note}>Update Pliny from TestFlight to add a photo.</Text>
            )}
          </View>

          <Eyebrow style={{ marginTop: 28, marginBottom: 10 }}>Your name</Eyebrow>
          <View style={styles.nameRow}>
            <TextInput
              value={name}
              onChangeText={(text) => {
                setNote(null);
                setError(null);
                setName(text);
              }}
              placeholder="First name"
              placeholderTextColor={colors.gray}
              accessibilityLabel="Your first name"
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="done"
              maxLength={40}
              onSubmitEditing={saveName}
              style={styles.input}
            />
            {changed ? (
              <Pressable onPress={saveName} accessibilityRole="button" style={styles.save}>
                <Text style={styles.saveText}>{saving ? 'Saving' : 'Save'}</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.note}>{note ?? 'Friends see it when you send them a story.'}</Text>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Eyebrow style={{ marginTop: 28, marginBottom: 10 }}>Your interests</Eyebrow>
          <Pressable accessibilityRole="button" onPress={() => router.push('/interests')} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
            <Text style={styles.rowText}>Edit interests</Text>
            <Icon name="chevron" size={20} />
          </Pressable>

          <Eyebrow style={{ marginTop: 28, marginBottom: 10 }}>Account</Eyebrow>
          <Text style={styles.account}>{email ? `Signed in as ${email}` : 'Signed in'}</Text>
          <OutlineButton label="Sign out" onPress={signOut} style={{ alignSelf: 'flex-start', marginTop: 12 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pictureRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  uploading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 48, backgroundColor: 'rgba(247,247,244,0.7)', alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minWidth: 0, height: 56, borderRadius: 28, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink, paddingHorizontal: 22, fontFamily: fonts.body, fontSize: 17, color: colors.ink },
  save: { height: 56, paddingHorizontal: 22, borderRadius: 28, backgroundColor: colors.yellow, borderWidth: 1.5, borderColor: colors.ink, justifyContent: 'center' },
  saveText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.gray, marginTop: 8, flexShrink: 1 },
  error: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 19, color: colors.vermilion, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 60, paddingHorizontal: 18, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.white },
  rowText: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.ink },
  account: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
});
