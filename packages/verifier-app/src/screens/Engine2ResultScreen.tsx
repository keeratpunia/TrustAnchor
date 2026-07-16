/**
 * Engine2ResultScreen.tsx — displays the result of Engine 2's forensic
 * document check: the combined overallVerdict (Engine 1 + Engine 2,
 * combiner.ts), the confidence breakdown, and a field-by-field comparison
 * so a verifier can see exactly WHAT matched or didn't, not just a single
 * pass/fail bit.
 * ============================================================================
 * Deliberately visually distinct from ResultScreen.tsx (Engine 1's result
 * screen) even though it reuses the same color language — this is evidence
 * from a network call against a photo, not an on-device cryptographic
 * fact, and the UI should never let those two look interchangeable. Its
 * verdict language is VERIFIED/NEEDS_REVIEW/REJECTED (combiner.ts's
 * OverallVerdict), never AUTHENTIC — that word is reserved for Engine 1's
 * own screen so the two are never visually confused.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Engine2VerifyResponse, FieldVerdict, AssetVerdict, Tier } from '../engine2/types';

interface Props {
  result: Engine2VerifyResponse;
  onScanAgain: () => void;
}

const OVERALL_META: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  VERIFIED: { label: 'VERIFIED', color: '#4ade80', bg: '#052e16', emoji: '✓' },
  NEEDS_REVIEW: { label: 'NEEDS REVIEW', color: '#fbbf24', bg: '#451a03', emoji: '?' },
  REJECTED: { label: 'REJECTED', color: '#f87171', bg: '#450a0a', emoji: '✗' },
};

const TIER_META: Record<Tier, { color: string; icon: string }> = {
  accept: { color: '#4ade80', icon: '✓' },
  review: { color: '#fbbf24', icon: '!' },
  reject: { color: '#f87171', icon: '✗' },
};

function formatFieldName(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function ConfidenceBar({ value, color }: { value: number; color: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

function FieldRow({ field }: { field: FieldVerdict }) {
  const meta = TIER_META[field.tier];
  const [expanded, setExpanded] = useState(field.tier !== 'accept');
  return (
    <TouchableOpacity style={styles.verdictRow} onPress={() => setExpanded((e) => !e)} activeOpacity={0.7}>
      <View style={styles.verdictRowHeader}>
        <Text style={[styles.verdictIcon, { color: meta.color }]}>{meta.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.verdictName}>
            {formatFieldName(field.field_name)}
            {field.is_mandatory ? '' : '  (optional)'}
          </Text>
          <ConfidenceBar value={field.similarity} color={meta.color} />
        </View>
        <Text style={[styles.verdictPct, { color: meta.color }]}>{Math.round(field.similarity * 100)}%</Text>
      </View>
      {expanded && <Text style={styles.verdictReason}>{field.reason}</Text>}
    </TouchableOpacity>
  );
}

function AssetRow({ asset }: { asset: AssetVerdict }) {
  const meta = TIER_META[asset.tier];
  const [expanded, setExpanded] = useState(asset.tier !== 'accept');
  return (
    <TouchableOpacity style={styles.verdictRow} onPress={() => setExpanded((e) => !e)} activeOpacity={0.7}>
      <View style={styles.verdictRowHeader}>
        <Text style={[styles.verdictIcon, { color: meta.color }]}>{meta.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.verdictName}>
            {formatFieldName(asset.asset_name)}
            {asset.is_mandatory ? '' : '  (optional)'}
          </Text>
          <ConfidenceBar value={asset.similarity} color={meta.color} />
        </View>
        <Text style={[styles.verdictPct, { color: meta.color }]}>{Math.round(asset.similarity * 100)}%</Text>
      </View>
      {expanded && <Text style={styles.verdictReason}>{asset.reason}</Text>}
    </TouchableOpacity>
  );
}

export default function Engine2ResultScreen({ result, onScanAgain }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const meta = OVERALL_META[result.overallVerdict] ?? OVERALL_META.REJECTED;
  const { confidence, templateMatch } = result;
  const templateMeta = TIER_META[templateMatch.tier];

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20 }}>
      <View style={[styles.verdictBox, { backgroundColor: meta.bg, borderColor: meta.color }]}>
        <Text style={[styles.verdictEmoji, { color: meta.color }]}>{meta.emoji}</Text>
        <Text style={[styles.verdictLabel, { color: meta.color }]}>{meta.label}</Text>
        <Text style={styles.verdictSubtext}>Deep document check against the issued record</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.confidenceHeader}>
          <Text style={styles.sectionTitle}>Overall Confidence</Text>
          <Text style={[styles.confidenceValue, { color: meta.color }]}>
            {Math.round(confidence.overall_confidence * 100)}%
          </Text>
        </View>
        <ConfidenceBar value={confidence.overall_confidence} color={meta.color} />
        <Text style={styles.reasonText}>{result.reason}</Text>
      </View>

      {result.fieldVerdicts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Field Comparison</Text>
          <Text style={styles.sectionSubtitle}>What's printed on the document vs. what was issued</Text>
          {result.fieldVerdicts.map((f) => (
            <FieldRow key={f.field_name} field={f} />
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Template Match</Text>
        <View style={styles.verdictRowHeader}>
          <Text style={[styles.verdictIcon, { color: templateMeta.color }]}>{templateMeta.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.verdictName}>Document Layout</Text>
            <ConfidenceBar value={templateMatch.template_match_score} color={templateMeta.color} />
          </View>
          <Text style={[styles.verdictPct, { color: templateMeta.color }]}>
            {Math.round(templateMatch.template_match_score * 100)}%
          </Text>
        </View>
        <Text style={styles.verdictReason}>{templateMatch.reason}</Text>
      </View>

      {result.assetVerdicts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reference Marks</Text>
          <Text style={styles.sectionSubtitle}>Logos, seals, and signatures compared to the template's records</Text>
          {result.assetVerdicts.map((a) => (
            <AssetRow key={a.asset_name} asset={a} />
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.detailsToggle} onPress={() => setShowDetails((s) => !s)}>
        <Text style={styles.detailsToggleText}>{showDetails ? 'Hide' : 'Show'} technical details</Text>
      </TouchableOpacity>

      {showDetails && (
        <View style={styles.section}>
          <DetailRow label="Alignment quality" value={`${Math.round(result.alignmentQuality * 100)}%`} />
          <DetailRow label="Screenshot likelihood" value={`${Math.round(result.screenshotLikelihood * 100)}%`} />
          <DetailRow label="Alignment stages completed" value={result.tiersCompleted.join(', ') || 'none'} />
          {confidence.notes.map((note, i) => (
            <Text key={i} style={styles.noteText}>
              • {note}
            </Text>
          ))}
          <Text style={styles.docId}>Verification ID: {result.verificationId}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.scanAgainButton} onPress={onScanAgain}>
        <Text style={styles.scanAgainText}>Verify Another Document</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a1120' },
  verdictBox: { borderWidth: 2, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 20 },
  verdictEmoji: { fontSize: 40, marginBottom: 8 },
  verdictLabel: { fontSize: 20, fontWeight: '900', textAlign: 'center' },
  verdictSubtext: { color: '#cbd5e1', fontSize: 13, marginTop: 6, textAlign: 'center' },
  section: { backgroundColor: '#111827', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1e293b' },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1.2 },
  sectionSubtitle: { color: '#475569', fontSize: 11, marginTop: 2, marginBottom: 10 },
  confidenceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  confidenceValue: { fontSize: 18, fontWeight: '900' },
  reasonText: { color: '#94a3b8', fontSize: 12, marginTop: 10, lineHeight: 18 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: '#1e293b', overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', borderRadius: 3 },
  verdictRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  verdictRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  verdictIcon: { fontSize: 16, fontWeight: '900', width: 18 },
  verdictName: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  verdictPct: { fontSize: 13, fontWeight: '800', marginLeft: 8, width: 42, textAlign: 'right' },
  verdictReason: { color: '#64748b', fontSize: 11, marginTop: 6, marginLeft: 28, lineHeight: 16 },
  detailsToggle: { alignItems: 'center', paddingVertical: 10, marginBottom: 4 },
  detailsToggleText: { color: '#3b82f6', fontSize: 13, fontWeight: '700' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  fieldLabel: { color: '#94a3b8', fontSize: 13 },
  fieldValue: { color: '#e2e8f0', fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  noteText: { color: '#64748b', fontSize: 11, marginTop: 8, lineHeight: 16 },
  docId: { color: '#475569', fontSize: 10, textAlign: 'center', marginTop: 16, fontFamily: 'monospace' },
  scanAgainButton: { backgroundColor: '#1e3a5f', paddingVertical: 16, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#3b6fa5', marginBottom: 40 },
  scanAgainText: { color: '#93c5fd', fontWeight: '700', fontSize: 15 },
});
