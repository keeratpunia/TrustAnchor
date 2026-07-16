/**
 * HomeScreen.tsx — the app's landing screen.
 * ============================================================================
 * Written for a layperson, deliberately — a verifier using this app has no
 * reason to know what "a manifest" or "a digital signature" are, and
 * shouldn't need to. This screen's job is to make one thing obvious (tap
 * here to check a document) and one thing visible without being alarming
 * (whether the app's trust data is current) — see the "Trust Data" card
 * below, which is the fix for the app previously giving no warning before
 * a scan that it was about to fail on stale data.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { fetchManifest } from '../api/client';

interface Props {
  onScan: () => void;
}

type FreshnessState = 'checking' | 'fresh' | 'stale' | 'unknown';

export default function HomeScreen({ onScan }: Props) {
  const [freshness, setFreshness] = useState<FreshnessState>('checking');
  const [validUntilLabel, setValidUntilLabel] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const checkTrustData = async () => {
    setChecking(true);
    setFreshness('checking');
    try {
      const manifest = (await fetchManifest()) as any;
      const validUntil = manifest?.payload?.valid_until;
      if (!validUntil) {
        setFreshness('unknown');
        return;
      }
      const isFresh = new Date(validUntil).getTime() > Date.now();
      setFreshness(isFresh ? 'fresh' : 'stale');
      setValidUntilLabel(new Date(validUntil).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    } catch {
      setFreshness('unknown');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkTrustData();
  }, []);

  const freshnessMeta: Record<FreshnessState, { color: string; label: string }> = {
    checking: { color: '#94a3b8', label: 'Checking…' },
    fresh: { color: '#4ade80', label: `Up to date${validUntilLabel ? ` (good until ${validUntilLabel})` : ''}` },
    stale: { color: '#fbbf24', label: 'Out of date — scans may be refused until this is fixed' },
    unknown: { color: '#94a3b8', label: 'Could not check — connect to the internet and try again' },
  };
  const meta = freshnessMeta[freshness];

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.emoji}>🛡️</Text>
        <Text style={styles.title}>TrustAnchor</Text>
        <Text style={styles.subtitle}>Check if a certificate or document is genuine — in seconds.</Text>
      </View>

      <TouchableOpacity style={styles.scanButton} onPress={onScan} activeOpacity={0.85}>
        <Text style={styles.scanButtonEmoji}>📷</Text>
        <Text style={styles.scanButtonText}>Scan a Document</Text>
        <Text style={styles.scanButtonHint}>Point your camera at the QR code printed on it</Text>
      </TouchableOpacity>

      <View style={styles.trustCard}>
        <View style={styles.trustCardHeader}>
          <Text style={styles.trustCardTitle}>App Status</Text>
          {checking && <ActivityIndicator size="small" color="#64748b" />}
        </View>
        <View style={styles.trustRow}>
          <View style={[styles.dot, { backgroundColor: meta.color }]} />
          <Text style={styles.trustLabel}>{meta.label}</Text>
        </View>
        {freshness === 'stale' && (
          <Text style={styles.trustDetail}>
            This isn't the document's fault — the app's own reference data needs refreshing. Try again in a moment.
          </Text>
        )}
        <TouchableOpacity onPress={checkTrustData} disabled={checking} style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>{checking ? 'Checking…' : 'Check Again'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.footer}>No account needed. Nothing you scan is stored on your phone.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a1120', padding: 24, justifyContent: 'space-between' },
  hero: { alignItems: 'center', marginTop: 40 },
  emoji: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#e2e8f0' },
  subtitle: { fontSize: 14, color: '#94a3b8', marginTop: 8, textAlign: 'center', paddingHorizontal: 20 },
  scanButton: {
    backgroundColor: '#2563eb',
    borderRadius: 20,
    paddingVertical: 28,
    alignItems: 'center',
    marginVertical: 20,
  },
  scanButtonEmoji: { fontSize: 36, marginBottom: 8 },
  scanButtonText: { fontSize: 19, fontWeight: '800', color: '#eff6ff' },
  scanButtonHint: { fontSize: 12.5, color: '#bfdbfe', marginTop: 6 },
  trustCard: { backgroundColor: '#111827', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#1e293b' },
  trustCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  trustCardTitle: { fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  trustLabel: { fontSize: 13.5, color: '#e2e8f0', fontWeight: '600', flex: 1 },
  trustDetail: { fontSize: 12, color: '#94a3b8', marginTop: 10, lineHeight: 17 },
  refreshButton: { marginTop: 14, alignSelf: 'flex-start' },
  refreshButtonText: { fontSize: 12.5, color: '#60a5fa', fontWeight: '700' },
  footer: { fontSize: 11.5, color: '#475569', textAlign: 'center', marginBottom: 8 },
});
