import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import * as Linking from 'expo-linking';
import { Colors } from '../../constants/colors';
import { PRIVACY_URL, TERMS_URL } from '../../constants/config';

// ⭐ PRIVACY POLICY / TERMS OF USE INSIDE THE APP (2026-11-07, the user's
// decision: "Can we make a page for each" — opened from Home and from the
// sign-in consent line instead of the phone's browser).
// ONE COPY: the text is loaded from momentsinframe.com each time the page
// opens (the website's public/privacy.html and public/terms.html), so the
// lawyer's version reaches the app the moment it is published there, with no
// app update and no second copy to keep in step. Only a few kinds of block
// are drawn — title, headings, paragraphs, bullet points — which is all the
// two pages use.

type Doc = 'privacy' | 'terms';
type Block = { kind: 'title' | 'heading' | 'para' | 'bullet' | 'note'; text: string };

const DOCS: Record<Doc, { title: string; url: string }> = {
  privacy: { title: 'Privacy Policy', url: PRIVACY_URL },
  terms: { title: 'Terms of Use', url: TERMS_URL },
};

function decode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Reads the page's own structure: the title, then everything inside <main>
// in order, then the footer line.
function parseLegalHtml(html: string): Block[] {
  const blocks: Block[] = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const re = /<(h1|h2|h3|p|li|footer)\b([^>]*)>([\s\S]*?)<\/\1>|<div class="intro">([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[4] !== undefined) { const t = decode(m[4]); if (t) blocks.push({ kind: 'para', text: t }); continue; }
    const tag = m[1].toLowerCase();
    const attrs = m[2] ?? '';
    const text = decode(m[3]);
    if (!text) continue;
    if (tag === 'h1') blocks.push({ kind: 'title', text });
    else if (tag === 'h2' || tag === 'h3') blocks.push({ kind: 'heading', text });
    else if (tag === 'li') blocks.push({ kind: 'bullet', text });
    else if (tag === 'footer' || /class="(updated|address)"/.test(attrs)) blocks.push({ kind: 'note', text });
    else blocks.push({ kind: 'para', text });
  }
  return blocks;
}

export default function LegalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ doc?: string }>();
  const doc: Doc = params.doc === 'terms' ? 'terms' : 'privacy';
  const { title, url } = DOCS[doc];
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setBlocks(null);
    try {
      const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(String(res.status));
      const parsed = parseLegalHtml(await res.text());
      if (parsed.length === 0) throw new Error('empty');
      setBlocks(parsed);
    } catch {
      setFailed(true);
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.failText}>Couldn't load.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(url)} style={{ marginTop: 14 }}>
            <Text style={styles.browserLink}>Open in browser</Text>
          </TouchableOpacity>
        </View>
      ) : !blocks ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {blocks.map((b, i) =>
            b.kind === 'title' ? <Text key={i} style={styles.title}>{b.text}</Text>
            : b.kind === 'heading' ? <Text key={i} style={styles.heading}>{b.text}</Text>
            : b.kind === 'bullet' ? (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.para}>•</Text>
                <Text style={[styles.para, styles.bulletText]}>{b.text}</Text>
              </View>
            )
            : b.kind === 'note' ? <Text key={i} style={styles.note}>{b.text}</Text>
            : <Text key={i} style={styles.para}>{b.text}</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: '#222' },
  back: { fontSize: 24, color: Colors.textMuted },
  headerTitle: { fontSize: 18, fontWeight: '500', color: Colors.white },
  scroll: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.white, marginBottom: 8 },
  heading: { fontSize: 16, fontWeight: '700', color: Colors.accent, marginTop: 20, marginBottom: 6 },
  para: { fontSize: 14, lineHeight: 22, color: '#C8C8C8', marginBottom: 8 },
  bulletRow: { flexDirection: 'row' },
  bulletText: { flex: 1, paddingLeft: 8 },
  note: { fontSize: 12, lineHeight: 18, color: Colors.textMuted, marginTop: 8, marginBottom: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  failText: { fontSize: 15, color: Colors.white, marginBottom: 16 },
  retryBtn: { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  retryText: { fontSize: 15, fontWeight: '700', color: '#0F0F0F' },
  browserLink: { fontSize: 14, color: Colors.textMuted, textDecorationLine: 'underline' },
});
