/**
 * ScanScreen.tsx — camera view that scans a QR code and hands the raw
 * bytes off to Engine 1 for verification.
 */
import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { verifyEngine1 } from '../engine1/engine1';
import { base64ToBytes } from '../engine1/qrCodec';
import { Engine1Result } from '../engine1/types';

interface Props {
  onResult: (result: Engine1Result) => void;
  onCancel?: () => void;
}

export default function ScanScreen({ onResult, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [verifying, setVerifying] = useState(false);
  const scannedRef = useRef(false); // prevents double-scans firing multiple verifications

  const handleBarcodeScanned = async (scanResult: BarcodeScanningResult) => {
    if (scannedRef.current || verifying) return;
    scannedRef.current = true;
    setVerifying(true);

    try {
      // The QR transports BASE64 TEXT, not raw binary bytes (see
      // offline-signer/src/generateQr.ts's header for why: raw binary in a
      // QR gets silently corrupted by scanners that internally treat byte
      // data as UTF-8 text). `scanResult.data` is therefore a plain ASCII
      // base64 string, which we decode back into the original CBOR bytes.
      const bytes = base64ToBytes(scanResult.data);

      const result = await verifyEngine1(bytes);
      onResult(result);
    } catch (err) {
      onResult({
        status: 'INVALID_QR',
        checks: [{ name: 'Verification', passed: false, detail: `Unexpected error: ${(err as Error).message}` }],
        issuerName: null,
        fields: null,
        assetHashes: null,
        templateHash: null,
        docId: null,
        issuedAt: null,
        expiresAt: null,
      });
    } finally {
      setVerifying(false);
      // Allow scanning again after a short delay once the result screen
      // has had a chance to take over navigation.
      setTimeout(() => {
        scannedRef.current = false;
      }, 2000);
    }
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>TrustAnchor needs camera access to scan a document's QR code.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={verifying ? undefined : handleBarcodeScanned}
      />
      <View style={styles.overlay}>
        {onCancel && (
          <TouchableOpacity onPress={onCancel} style={styles.backButton} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
            <Text style={styles.backButtonText}>‹ Back</Text>
          </TouchableOpacity>
        )}
        <View style={styles.frame} />
        <Text style={styles.hint}>
          {verifying ? 'Verifying...' : 'Point the camera at the QR code on the document'}
        </Text>
        {verifying && <ActivityIndicator color="#4ade80" style={{ marginTop: 12 }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0a1120' },
  permissionText: { color: '#94a3b8', fontSize: 15, textAlign: 'center', marginBottom: 20 },
  button: { backgroundColor: '#1e3a5f', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: '#3b6fa5' },
  buttonText: { color: '#93c5fd', fontWeight: '700', fontSize: 15 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backButton: { position: 'absolute', top: 12, left: 16, padding: 8 },
  backButtonText: { color: '#fff', fontSize: 16, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: '#4ade80', borderRadius: 16, backgroundColor: 'transparent' },
  hint: { color: '#fff', marginTop: 24, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
});
