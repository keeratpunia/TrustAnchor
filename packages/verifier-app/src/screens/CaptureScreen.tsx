/**
 * CaptureScreen.tsx — captures a photo of the physical document and
 * uploads it for Engine 2 forensic verification (POST /v2/verify/:docId).
 * ============================================================================
 * Three phases, each with its own screen so the user always knows exactly
 * what's happening and is never left staring at an ambiguous spinner:
 *
 *   'camera'    — live camera preview with a document-shaped guide frame
 *                 and a shutter button.
 *   'preview'   — the just-captured photo, full-screen, with Retake/
 *                 Use Photo actions — mirrors the "confirm before you
 *                 commit" pattern every scanning app uses, since a blurry
 *                 or badly-cropped capture directly costs Engine 2 accuracy
 *                 and it's much cheaper to retake now than to wait through
 *                 a whole upload+pipeline round trip first.
 *   'uploading' — upload + Engine 2 pipeline in flight. Shows a sequence
 *                 of stage-labeled messages (purely cosmetic — the server
 *                 doesn't stream real progress — but it turns an
 *                 otherwise-blank multi-second wait into something that
 *                 reads as "working," not "stuck").
 *
 * A failure at any point (camera error, upload error, backend error) lands
 * on a dedicated error state with the SPECIFIC reason (not a generic
 * "something went wrong") and a Retry action that returns to the camera —
 * never a dead end.
 */
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { postVerifyEngine2, NetworkError, Engine2ApiError } from '../api/client';
import { Engine1Result } from '../engine1/types';
import { Engine2VerifyResponse } from '../engine2/types';

interface Props {
  docId: string;
  engine1Result: Engine1Result;
  onVerified: (result: Engine2VerifyResponse) => void;
  onCancel: () => void;
}

type Phase = 'camera' | 'preview' | 'uploading' | 'error';

// Purely cosmetic — cycles while the real request is in flight, giving the
// (genuinely multi-second) Engine 2 pipeline a sense of visible progress.
// Stays on the last message rather than looping, since looping would make
// an unusually slow request look broken/stuck in a different way.
const UPLOAD_STAGE_MESSAGES = [
  'Uploading photo…',
  'Aligning document…',
  'Reading printed text…',
  'Comparing against issued record…',
  'Scoring confidence…',
];
const UPLOAD_STAGE_INTERVAL_MS = 1400;

export default function CaptureScreen({ docId, engine1Result, onVerified, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('camera');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [stageIndex, setStageIndex] = useState(0);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (phase !== 'uploading') return;
    setStageIndex(0);
    const interval = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, UPLOAD_STAGE_MESSAGES.length - 1));
    }, UPLOAD_STAGE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [phase]);

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) {
        throw new Error('Camera returned no image.');
      }
      setPhotoUri(photo.uri);
      setPhase('preview');
    } catch (err) {
      setErrorMessage(`Could not capture the photo: ${(err as Error).message}`);
      setPhase('error');
    } finally {
      setCapturing(false);
    }
  };

  const handleRetake = () => {
    setPhotoUri(null);
    setPhase('camera');
  };

  const handleConfirm = async () => {
    if (!photoUri) return;
    setPhase('uploading');
    try {
      const result = await postVerifyEngine2(docId, photoUri, engine1Result);
      onVerified(result);
    } catch (err) {
      if (err instanceof Engine2ApiError) {
        setErrorMessage(describeApiError(err));
      } else if (err instanceof NetworkError) {
        setErrorMessage('Could not reach the verification server. Check your connection and try again.');
      } else {
        setErrorMessage((err as Error).message);
      }
      setPhase('error');
    }
  };

  const handleRetryFromError = () => {
    setPhotoUri(null);
    setPhase('camera');
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
        <Text style={styles.permissionText}>
          TrustAnchor needs camera access to photograph the document for a deeper forensic check.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={onCancel}>
          <Text style={styles.linkButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorEmoji}>⚠</Text>
        <Text style={styles.errorTitle}>Couldn't Complete Verification</Text>
        <Text style={styles.errorDetail}>{errorMessage}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleRetryFromError}>
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={onCancel}>
          <Text style={styles.linkButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'uploading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#4ade80" size="large" />
        <Text style={styles.uploadingStage}>{UPLOAD_STAGE_MESSAGES[stageIndex]}</Text>
        <Text style={styles.uploadingHint}>This can take up to half a minute.</Text>
      </View>
    );
  }

  if (phase === 'preview' && photoUri) {
    return (
      <View style={styles.container}>
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFillObject} resizeMode="contain" />
        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleRetake}>
            <Text style={styles.secondaryButtonText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={handleConfirm}>
            <Text style={styles.primaryButtonText}>Use This Photo</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" />
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.documentFrame} />
        <Text style={styles.hint}>Fit the entire document inside the frame, with good lighting</Text>
      </View>
      <View style={styles.shutterRow}>
        <TouchableOpacity
          style={[styles.shutterButton, capturing && styles.shutterButtonDisabled]}
          onPress={handleCapture}
          disabled={capturing}
        >
          {capturing ? <ActivityIndicator color="#0a1120" /> : <View style={styles.shutterInner} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function describeApiError(err: Engine2ApiError): string {
  switch (err.code) {
    case 'DOCUMENT_REVOKED':
      return 'This document has been revoked and cannot be verified.';
    case 'CREDENTIAL_NOT_FOUND':
      return 'No credential record was found for this document.';
    case 'TEMPLATE_NOT_CONFIGURED':
      return "This document's template has not been configured for deep verification yet. Contact the issuer.";
    case 'ENGINE2_SERVICE_ERROR':
      return 'The verification service is temporarily unavailable. Please try again shortly.';
    default:
      return err.message;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0a1120' },
  permissionText: { color: '#94a3b8', fontSize: 15, textAlign: 'center', marginBottom: 20 },
  topBar: { position: 'absolute', top: Platform.OS === 'ios' ? 12 : 20, left: 20, zIndex: 10 },
  cancelText: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  documentFrame: {
    width: '82%',
    height: '58%',
    borderWidth: 3,
    borderColor: 'rgba(74, 222, 128, 0.9)',
    borderRadius: 14,
    backgroundColor: 'transparent',
  },
  hint: {
    color: '#fff',
    marginTop: 20,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 40,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
  shutterRow: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutterButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  shutterButtonDisabled: { opacity: 0.6 },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  previewActions: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#16a34a',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#f0fdf4', fontWeight: '700', fontSize: 15 },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'rgba(30,41,59,0.9)',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryButtonText: { color: '#cbd5e1', fontWeight: '700', fontSize: 15 },
  linkButton: { marginTop: 16, padding: 8 },
  linkButtonText: { color: '#64748b', fontSize: 14, fontWeight: '600' },
  errorEmoji: { fontSize: 40, marginBottom: 12, color: '#f87171' },
  errorTitle: { color: '#f87171', fontSize: 18, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  errorDetail: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  uploadingStage: { color: '#e2e8f0', fontSize: 16, fontWeight: '700', marginTop: 20, textAlign: 'center' },
  uploadingHint: { color: '#64748b', fontSize: 13, marginTop: 8, textAlign: 'center' },
});
