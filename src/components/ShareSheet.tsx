// Share this story: a link to the story on itspliny.com that anyone can play in full. Opened from
// the wrap screen, the player and the Library. Friends who join the waitlist move the sharer up.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Share, StyleSheet, Switch, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { CoverTile } from '@/components/covers';
import { BigButton, Em, Icon, OutlineButton, RoundButton, Serif } from '@/components/ui';
import { prepareShare, shareLesson, type Shared } from '@/lib/api';
import { useProfile } from '@/state/profile';
import { colors, fonts } from '@/theme';

// Copying needs a part of the app that older installs do not have. There, only Share is offered.
type Clip = typeof import('expo-clipboard');
let clipboard: Clip | null = null;
try {
  clipboard = require('expo-clipboard') as Clip;
} catch {
  clipboard = null;
}

export function ShareSheet({ lessonId, title, onClose }: { lessonId: string | null; title: string; onClose: () => void }) {
  const firstName = useProfile((s) => s.first_name);
  // What the sheet shows stays put while it slides away, after lessonId has gone.
  const [shown, setShown] = useState<{ id: string; title: string } | null>(null);
  const [shared, setShared] = useState<Shared | null>(null);
  const [showName, setShowName] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The link to hand to iOS once the sheet has fully gone. Opening iOS's share screen on top of
  // this one could leave the app unable to take a tap after coming back from it.
  const handOff = useRef<string | null>(null);

  useEffect(() => {
    if (!lessonId) return;
    setShown({ id: lessonId, title });
    setError(null);
    setCopied(false);
    // Usually ready already: it was asked for when the story was opened.
    prepareShare(lessonId)
      .then((s) => {
        setShared(s);
        setShowName(s.show_name);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'The link could not be made. Try again.'));
  }, [lessonId, title]);

  const markSent = (name = showName) => {
    if (shown) shareLesson(shown.id, name, true).then(setShared).catch(() => {});
  };
  const toggleName = (on: boolean) => {
    setShowName(on);
    if (shown) shareLesson(shown.id, on).then(setShared).catch(() => setShowName(!on));
  };
  const share = () => {
    if (!shared) return;
    markSent();
    handOff.current = shared.url;
    onClose();
  };
  const copy = async () => {
    if (!shared || !clipboard) return;
    await clipboard.setStringAsync(shared.url);
    markSent();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const closed = () => {
    const url = handOff.current;
    handOff.current = null;
    setShown(null);
    setShared(null);
    // Only the link goes to iOS, so Copy there copies the link and a text shows its preview.
    if (url) setTimeout(() => Share.share(Platform.OS === 'ios' ? { url } : { message: url }).catch(() => {}), 50);
  };

  return (
    <BottomSheet open={Boolean(lessonId)} onClose={onClose} onClosed={closed}>
      <View style={styles.head}>
        <Serif size={40}>
          Share this <Em>story.</Em>
        </Serif>
        <RoundButton label="Close" onPress={onClose}>
          <Icon name="close" size={20} />
        </RoundButton>
      </View>

      <View style={styles.card}>
        {shared ? <CoverTile id={shown?.id ?? ''} art={shared.art} size={72} /> : <View style={styles.coverWait} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {shown?.title ?? title}
          </Text>
          <Text style={styles.link} numberOfLines={1}>
            {shared ? shared.url.replace(/^https:\/\//, '') : error ?? 'Making the link'}
          </Text>
        </View>
      </View>

      <View style={styles.nameRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.nameTitle}>Show my first name</Text>
          <Text style={styles.nameNote}>{firstName ? `They’ll see “${firstName} sent you a story”` : 'They’ll see who sent it'}</Text>
        </View>
        <Switch value={showName} onValueChange={toggleName} trackColor={{ true: colors.ink, false: colors.line }} thumbColor={showName ? colors.yellow : colors.white} ios_backgroundColor={colors.line} />
      </View>

      <View style={styles.note}>
        <Text style={styles.noteText}>
          {shared?.finishing ? 'The rest of this story gets finished once you send it, so friends can hear all of it. ' : 'Friends can hear the whole story free. '}
          Each one who joins the waitlist moves you up.
        </Text>
      </View>

      {shared ? (
        <>
          <BigButton label="Share" icon="share" onPress={share} />
          {clipboard ? <OutlineButton label={copied ? 'Copied' : 'Copy link'} height={60} textSize={18} onPress={copy} style={{ marginTop: 10 }} /> : null}
        </>
      ) : (
        <View style={styles.wait}>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.ink} />}</View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  coverWait: { width: 72, height: 72, backgroundColor: colors.line },
  cardTitle: { fontFamily: fonts.bodySemi, fontSize: 17, lineHeight: 21, color: colors.ink },
  link: { fontFamily: fonts.body, fontSize: 14, color: colors.gray, marginTop: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  nameTitle: { fontFamily: fonts.bodySemi, fontSize: 17, color: colors.ink },
  nameNote: { fontFamily: fonts.body, fontSize: 14, color: colors.gray, marginTop: 2 },
  note: { backgroundColor: colors.yellow, padding: 14, marginTop: 18, marginBottom: 18 },
  noteText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  wait: { height: 64, alignItems: 'center', justifyContent: 'center' },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.vermilion, textAlign: 'center' },
});
