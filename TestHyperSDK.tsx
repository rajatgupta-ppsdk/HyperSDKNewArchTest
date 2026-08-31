/**
 * HyperSDK harness for RN 0.86.2 New Architecture (Fabric + TurboModules).
 *
 * Sequence mirrors juspay/hyper-sdk-react example/src/HomeScreen.tsx:
 *   1. NativeEventEmitter listener on HyperSdkReact.HyperEvent
 *   2. createHyperServices()
 *   3. initiate(payload)  -> resolves asynchronously via an "initiate_result" event
 *   4. only then does isInitialised() return true
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Button,
  ScrollView,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import HyperSdkReact, { HyperFragmentView } from 'hyper-sdk-react';

// Demo merchant used by the official example; assets are published for this id.
const MERCHANT_ID = 'geddit';
const CLIENT_ID = 'geddit';

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export const TestHyperSDK = () => {
  const [log, setLog] = React.useState<string[]>([]);
  const [initialised, setInitialised] = React.useState(false);

  const append = React.useCallback((line: string) => {
    console.log('[HyperSDK]', line);
    setLog((prev) => [...prev.slice(-40), line]);
  }, []);

  // 1. Listener must exist BEFORE initiate() — results arrive as events.
  React.useEffect(() => {
    const emitter = new NativeEventEmitter(NativeModules.HyperSdkReact);
    const sub = emitter.addListener(HyperSdkReact.HyperEvent, (resp: string) => {
      let event = resp;
      try {
        const parsed = JSON.parse(resp);
        event = parsed.event ?? 'unknown';
        append(`event: ${event}  ${JSON.stringify(parsed).slice(0, 300)}`);
        if (event === 'initiate_result') {
          HyperSdkReact.isInitialised().then((v) => {
            setInitialised(v);
            append(`isInitialised() -> ${v}`);
          });
        }
      } catch {
        append(`event (raw): ${String(resp).slice(0, 300)}`);
      }
    });
    append(`listener attached on "${HyperSdkReact.HyperEvent}" (${Platform.OS})`);
    append(`Fabric: ${(globalThis as any)?.nativeFabricUIManager ? 'YES' : 'NO'}`);
    return () => sub.remove();
  }, [append]);

  const doInitiate = () => {
    try {
      HyperSdkReact.createHyperServices();
      append('createHyperServices() called');

      const payload = {
        requestId: uuid(),
        service: 'in.juspay.hyperapi',
        betaAssets: false,
        payload: {
          action: 'initiate',
          merchantId: MERCHANT_ID,
          clientId: CLIENT_ID,
          customerId: 'test_customer',
          environment: 'sandbox',
        },
      };
      HyperSdkReact.initiate(JSON.stringify(payload));
      append('initiate() called — awaiting initiate_result event…');
    } catch (e: any) {
      append(`ERROR in initiate: ${e?.message ?? String(e)}`);
    }
  };

  const checkStatus = async () => {
    try {
      const v = await HyperSdkReact.isInitialised();
      setInitialised(v);
      append(`isInitialised() -> ${v}`);
    } catch (e: any) {
      append(`ERROR isInitialised: ${e?.message ?? String(e)}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HyperSDK — New Architecture harness</Text>
      <Text style={styles.status}>
        {initialised ? 'INITIALISED' : 'not initialised'}
      </Text>

      <View style={styles.row}>
        <Button title="1. Initiate" onPress={doInitiate} />
        <View style={styles.gap} />
        <Button title="2. Check status" onPress={checkStatus} />
        <View style={styles.gap} />
        <Button title="Clear" onPress={() => setLog([])} />
      </View>

      <Text style={styles.subtitle}>Events</Text>
      <ScrollView style={styles.logBox}>
        {log.length === 0 ? (
          <Text style={styles.dim}>no events yet</Text>
        ) : (
          log.map((l, i) => (
            <Text key={i} style={styles.logLine}>
              {l}
            </Text>
          ))
        )}
      </ScrollView>

      {/* Fabric props path: ns/payload are passed as props under New Arch. */}
      <Text style={styles.subtitle}>HyperFragmentView (Fabric props path)</Text>
      <View style={styles.fragmentBox}>
        <HyperFragmentView
          height={180}
          width={320}
          namespace="test_fragment"
          payload={JSON.stringify({
            requestId: uuid(),
            service: 'in.juspay.hyperapi',
            payload: { action: 'test', merchantId: MERCHANT_ID },
          })}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  subtitle: { fontSize: 14, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  status: { fontSize: 14, marginBottom: 12, color: '#555' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  gap: { width: 8 },
  logBox: {
    height: 220,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    backgroundColor: '#fafafa',
  },
  logLine: { fontSize: 10, fontFamily: 'Courier', marginBottom: 3 },
  dim: { fontSize: 11, color: '#999' },
  fragmentBox: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 6,
  },
});
