/**
 * App.tsx — top-level app component and screen state machine.
 * ============================================================================
 * Flow: scan (Engine 1, on-device crypto) -> engine1Result -> optionally,
 * if Engine 1 said AUTHENTIC and a docId is available, capture (photograph
 * the physical document) -> engine2Result (Engine 2's forensic check,
 * combined with Engine 1's into one overallVerdict by combiner.ts).
 *
 * Modeled as a discriminated union rather than several independent
 * booleans/nullables, so each screen only ever renders with EXACTLY the
 * data it needs already in hand — e.g. CaptureScreen's props require a
 * `docId: string` (not `string | null`), which is only possible because
 * the 'capture' state is only ever reachable via a transition that already
 * checked `engine1.docId` was non-null.
 */
import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, StatusBar } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import ScanScreen from './src/screens/ScanScreen';
import ResultScreen from './src/screens/ResultScreen';
import CaptureScreen from './src/screens/CaptureScreen';
import Engine2ResultScreen from './src/screens/Engine2ResultScreen';
import { Engine1Result } from './src/engine1/types';
import { Engine2VerifyResponse } from './src/engine2/types';

type Screen =
  | { name: 'home' }
  | { name: 'scan' }
  | { name: 'engine1Result'; engine1: Engine1Result }
  | { name: 'capture'; engine1: Engine1Result; docId: string }
  | { name: 'engine2Result'; engine2: Engine2VerifyResponse };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  const resetToHome = () => setScreen({ name: 'home' });

  return (
    <SafeAreaView style={styles.container}>
      <ExpoStatusBar style="light" />

      {screen.name === 'home' && <HomeScreen onScan={() => setScreen({ name: 'scan' })} />}

      {screen.name === 'scan' && (
        <ScanScreen onResult={(engine1) => setScreen({ name: 'engine1Result', engine1 })} onCancel={resetToHome} />
      )}

      {screen.name === 'engine1Result' && (
        <ResultScreen
          result={screen.engine1}
          onScanAgain={resetToHome}
          onDeepVerify={
            screen.engine1.status === 'AUTHENTIC' && screen.engine1.docId
              ? () => setScreen({ name: 'capture', engine1: screen.engine1, docId: screen.engine1.docId as string })
              : undefined
          }
        />
      )}

      {screen.name === 'capture' && (
        <CaptureScreen
          docId={screen.docId}
          engine1Result={screen.engine1}
          onVerified={(engine2) => setScreen({ name: 'engine2Result', engine2 })}
          onCancel={() => setScreen({ name: 'engine1Result', engine1: screen.engine1 })}
        />
      )}

      {screen.name === 'engine2Result' && (
        <Engine2ResultScreen result={screen.engine2} onScanAgain={resetToHome} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a1120',
    paddingTop: StatusBar.currentHeight ?? 0,
  },
});
