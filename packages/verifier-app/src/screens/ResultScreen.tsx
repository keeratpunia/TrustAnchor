/**
 * ResultScreen.tsx — displays the Engine1Result verdict.
 * ============================================================================
 * Written for a layperson first: a big plain-language headline and a
 * one-sentence explanation of what it actually means, with the full
 * technical check-by-check trace (still complete, still transparent —
 * Frozen Spec §14's checks are never hidden, only collapsed) available
 * one tap away for anyone who wants it. Nobody should need to know what
 * "a manifest" or "a digital signature" are to understand their result.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Engine1Result } from '../engine1/types';

interface Props {
  result: Engine1Result;
  onScanAgain: () => void;
  onDeepVerify?: () => void;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; emoji: string; explanation: string }> = {
  AUTHENTIC: {
    label: 'Genuine',
    color: '#4ade80',
    bg: '#052e16',
    emoji: '✅',
    explanation: "This document's details match exactly what the issuer originally created — nothing has been altered.",
  },
  REVOKED: {
    label: 'Revoked',
    color: '#f87171',
    bg: '#450a0a',
    emoji: '⛔',
    explanation: 'The issuer has withdrawn this document — it was once genuine but should no longer be treated as valid.',
  },
  EXPIRED: {
    label: 'Expired',
    color: '#fbbf24',
    bg: '#451a03',
    emoji: '⏱',
    explanation: 'This document was genuinely issued, but it has passed its validity date.',
  },
  NETWORK_ERROR: {
    label: "Couldn't Check",
    color: '#94a3b8',
    bg: '#1e293b',
    emoji: '📡',
    explanation: "We couldn't reach the verification server. This says nothing about the document — check your internet connection and try again.",
  },
  MANIFEST_STALE: {
    label: "Couldn't Check Right Now",
    color: '#fbbf24',
    bg: '#451a03',
    emoji: '🔄',
    explanation: "This isn't a problem with the document — the app's own reference data needs refreshing. Try again in a moment.",
  },
};

function metaFor(status: string) {
  return (
    STATUS_META[status] ?? {
      label: 'Not Genuine',
      color: '#f87171',
      bg: '#450a0a',
      emoji: '❌',
      explanation: "This document's details don't match what the issuer actually created — treat it as forged or tampered with.",
    }
  );
}

/** Plain-language translation of each technical check name — the trace itself is never hidden, just made readable. */
const CHECK_TRANSLATIONS: Record<string, string> = {
  'QR Decode': 'Read the QR code',
  'Trust Manifest': "Downloaded the issuer's reference list",
  'Trust Manifest Signature': "Confirmed the reference list itself hasn't been tampered with",
  'Manifest Freshness': 'Confirmed the reference list is up to date',
  'Issuer Trust': 'Confirmed the issuer is a recognized, active institution',
  'Credential Fetch': "Downloaded the document's official details",
  'Content Integrity': "Confirmed the details haven't been altered",
  'Identity Binding': 'Confirmed the QR code matches these exact details',
  Signature: "Confirmed the issuer's digital seal is genuine",
  Revocation: "Checked it hasn't been withdrawn by the issuer",
  Expiry: "Checked it's still within its validity date",
};

function translateCheckName(name: string): string {
  return CHECK_TRANSLATIONS[name] ?? name;
}

function formatFieldName(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function ResultScreen({ result, onScanAgain, onDeepVerify }: Props) {
  const meta = metaFor(result.status);
  const [showDetails, setShowDetails] = useState(false);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20 }}>
      <View style={[styles.verdictBox, { backgroundColor: meta.bg, borderColor: meta.color }]}>
        <Text style={styles.verdictEmoji}>{meta.emoji}</Text>
        <Text style={[styles.verdictLabel, { color: meta.color }]}>{meta.label}</Text>
        <Text style={styles.verdictExplanation}>{meta.explanation}</Text>
        {result.issuerName && <Text style={styles.issuerName}>Issued by {result.issuerName}</Text>}
      </View>

      {result.status === 'AUTHENTIC' && result.fields && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What's Officially On Record</Text>
          {Object.entries(result.fields).map(([key, value]) => (
            <View key={key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{formatFieldName(key)}</Text>
              <Text style={styles.fieldValue}>{value}</Text>
            </View>
          ))}
          {result.issuedAt && (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Issued</Text>
              <Text style={styles.fieldValue}>{new Date(result.issuedAt).toLocaleDateString()}</Text>
            </View>
          )}
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Expires</Text>
            <Text style={styles.fieldValue}>{result.expiresAt ? new Date(result.expiresAt).toLocaleDateString() : 'Never'}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.detailsToggle} onPress={() => setShowDetails((s) => !s)}>
        <Text style={styles.detailsToggleText}>{showDetails ? 'Hide' : 'Show'} how we checked this</Text>
      </TouchableOpacity>

      {showDetails && (
        <View style={styles.section}>
          {result.checks.map((check, i) => (
            <View key={i} style={styles.checkRow}>
              <Text style={[styles.checkIcon, { color: check.passed ? '#4ade80' : '#f87171' }]}>
                {check.passed ? '✓' : '✗'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkName}>{translateCheckName(check.name)}</Text>
                <Text style={styles.checkDetail}>{check.detail}</Text>
              </View>
            </View>
          ))}
          {result.docId && <Text style={styles.docId}>Document ID: {result.docId}</Text>}
        </View>
      )}

      {onDeepVerify && (
        <View style={styles.deepVerifySection}>
          <Text style={styles.deepVerifyTitle}>Want to go further?</Text>
          <Text style={styles.deepVerifyBody}>
            This confirms the document's details are genuine. To also check that the printed text on the
            physical document matches what was issued, take a photo of it.
          </Text>
          <TouchableOpacity style={styles.deepVerifyButton} onPress={onDeepVerify}>
            <Text style={styles.deepVerifyButtonText}>Photograph Document for Deep Check</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.scanAgainButton} onPress={onScanAgain}>
        <Text style={styles.scanAgainText}>Scan Another Document</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a1120' },
  verdictBox: { borderWidth: 2, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 20 },
  verdictEmoji: { fontSize: 40, marginBottom: 8 },
  verdictLabel: { fontSize: 22, fontWeight: '900', textAlign: 'center' },
  verdictExplanation: { color: '#cbd5e1', fontSize: 13.5, marginTop: 10, textAlign: 'center', lineHeight: 19 },
  issuerName: { color: '#94a3b8', fontSize: 12.5, marginTop: 10 },
  section: { backgroundColor: '#111827', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1e293b' },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  fieldLabel: { color: '#94a3b8', fontSize: 13 },
  fieldValue: { color: '#e2e8f0', fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  detailsToggle: { alignItems: 'center', paddingVertical: 10, marginBottom: 4 },
  detailsToggleText: { color: '#3b82f6', fontSize: 13, fontWeight: '700' },
  checkRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  checkIcon: { fontSize: 16, fontWeight: '900', width: 20 },
  checkName: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  checkDetail: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  docId: { color: '#475569', fontSize: 10, textAlign: 'center', marginTop: 12, fontFamily: 'monospace' },
  deepVerifySection: { backgroundColor: '#0f1e30', borderRadius: 16, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: '#1e3a5f' },
  deepVerifyTitle: { color: '#93c5fd', fontSize: 14, fontWeight: '800', marginBottom: 6 },
  deepVerifyBody: { color: '#94a3b8', fontSize: 12, lineHeight: 18, marginBottom: 14 },
  deepVerifyButton: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  deepVerifyButtonText: { color: '#eff6ff', fontWeight: '700', fontSize: 14 },
  scanAgainButton: { backgroundColor: '#1e3a5f', paddingVertical: 16, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#3b6fa5', marginBottom: 40 },
  scanAgainText: { color: '#93c5fd', fontWeight: '700', fontSize: 15 },
});
