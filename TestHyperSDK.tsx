/**
 * HyperSDK harness for RN 0.86.2 New Architecture (Fabric + TurboModules).
 *
 * Mirrors the official example's sequence:
 *   1. NativeEventEmitter listener on HyperSdkReact.HyperEvent
 *   2. createHyperServices()
 *   3. initiate(payload)       -> resolves via an "initiate_result" event
 *   4. create + sign an order  -> builds a real HyperFragmentView payload
 *   5. HyperFragmentView mounts with that payload
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
import creds from './credentials.local.json';
import {
  createOrder,
  generateOrderId,
  generateSign,
  buildOrderDetails,
  buildInitiateSignaturePayload,
} from './hyperApi';

// No 'geddit' fallbacks: a missing key must fail visibly in the log, not
// silently sign payloads for a different merchant.
const MERCHANT_ID = creds.merchantId || '';
const CLIENT_ID = creds.clientId || '';
const CUSTOMER_ID = creds.customerId || 'test_customer';
const ENVIRONMENT = creds.environment || 'sandbox';

const API_KEY = creds.apiKey || '';
const PRIVATE_KEY = creds.privateKey || '';
const MERCHANT_KEY_ID = creds.merchantKeyId || '';
const ORDER_ID = creds.orderId || '';
const AMOUNT = creds.amount || '1.00';
const MOBILE = creds.mobile || '9999999999';
const EMAIL = creds.email || 'test@example.com';

// 'test' is NOT a real action - it returns JP_003 "Unknown action".
// Valid fragment namespaces per the example: 'quickPay' or 'paymentWidget'.
const FRAGMENT_SERVICE = creds.fragmentService || 'in.juspay.hyperpay';
const FRAGMENT_ACTION = creds.fragmentAction || 'paymentPage';
const FRAGMENT_NAMESPACE = creds.fragmentNamespace || 'paymentWidget';

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export const TestHyperSDK = () => {
  const [log, setLog] = React.useState<string[]>([]);
  const [initialised, setInitialised] = React.useState(false);
  // null until an order is created + signed. Held in state so the prop stays
  // stable across renders - regenerating it each render loops the native
  // setPayload -> process -> event -> setState cycle forever.
  const [fragmentPayload, setFragmentPayload] = React.useState<string | null>(
    null
  );

  const append = React.useCallback((line: string) => {
    console.log('[HyperSDK]', line);
    setLog((prev) => [...prev.slice(-40), line]);
  }, []);

  // HyperServices is a native singleton that outlives this component. If the
  // harness is unmounted (toggle back to screen 1) with the widget live, the
  // native view keeps drawing over the next screen. Terminate on unmount.
  React.useEffect(() => {
    return () => {
      try {
        HyperSdkReact.terminate();
      } catch {
        // Terminate throws if createHyperServices was never called.
      }
    };
  }, []);

  // Listener must exist BEFORE initiate() - results arrive as events.
  React.useEffect(() => {
    const emitter = new NativeEventEmitter(NativeModules.HyperSdkReact);
    const sub = emitter.addListener(HyperSdkReact.HyperEvent, (resp: string) => {
      try {
        const parsed = JSON.parse(resp);
        const event = parsed.event ?? 'unknown';
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
      if (!MERCHANT_ID || !CLIENT_ID) {
        append('SKIP: merchantId and clientId must be set in credentials.local.json');
        return;
      }
      HyperSdkReact.createHyperServices();
      append('createHyperServices() called');

      // The PP (payment page) flow initiates in.juspay.hyperpay with a SIGNED
      // payload - mirrors the example's generatePPInitiatePayload. An unsigned
      // in.juspay.hyperapi initiate (Express Checkout) leaves hyperpay
      // un-initiated, so the paymentWidget never renders.
      if (!PRIVATE_KEY || !MERCHANT_KEY_ID) {
        append('SKIP: PP initiate needs privateKey + merchantKeyId in credentials.local.json');
        return;
      }

      const signaturePayload = JSON.stringify(
        buildInitiateSignaturePayload({
          merchantId: MERCHANT_ID,
          customerId: CUSTOMER_ID,
        })
      );
      const signature = generateSign(PRIVATE_KEY, signaturePayload);
      append('signed initiate payload');

      HyperSdkReact.initiate(
        JSON.stringify({
          requestId: uuid(),
          service: FRAGMENT_SERVICE,
          betaAssets: false,
          payload: {
            action: 'initiate',
            clientId: CLIENT_ID,
            merchantId: MERCHANT_ID,
            signaturePayload,
            signature,
            merchantKeyId: MERCHANT_KEY_ID,
            environment: ENVIRONMENT,
          },
        })
      );
      append(`initiate() called on ${FRAGMENT_SERVICE} - awaiting initiate_result event...`);
    } catch (e: any) {
      append(`ERROR in initiate: ${e?.message ?? String(e)}`);
    }
  };

  /** Creates a real sandbox order, signs it, and builds the fragment payload. */
  /**
   * Builds the signed payment payload: creates (or reuses) a sandbox order,
   * signs orderDetails, and returns the payload string.
   *
   * The SAME payload drives both paths. The fragment path differs only in that
   * the native side injects `fragmentViewGroups` before calling process()
   * (HyperSdkReact.mm) - so running it without the fragment isolates whether a
   * failure is in the Fabric/widget path or in the payload/SDK itself.
   */
  const buildSignedPayload = async (): Promise<string | null> => {
    if (!MERCHANT_ID || !CLIENT_ID) {
      append('SKIP: merchantId and clientId must be set in credentials.local.json');
      return null;
    }
    // Signing needs only these two. apiKey is required solely to CREATE an
    // order - supply an existing orderId instead and it is not needed.
    if (!PRIVATE_KEY || !MERCHANT_KEY_ID) {
      append('SKIP: signing needs privateKey + merchantKeyId in credentials.local.json');
      return null;
    }

    let orderId = ORDER_ID;
    if (orderId) {
      append(`using existing orderId ${orderId} (skipping order/create)`);
    } else {
      if (!API_KEY) {
        append('SKIP: no orderId set, and apiKey is empty so an order cannot be created.');
        append('      Either set apiKey, or paste an existing order_id into orderId.');
        return null;
      }
      orderId = generateOrderId();
      append(`creating order ${orderId} for ${AMOUNT}...`);
      const order = await createOrder({
        apiKey: API_KEY,
        orderId,
        amount: AMOUNT,
        customerId: CUSTOMER_ID,
        mobile: MOBILE,
        email: EMAIL,
      });
      append(`order created: status=${String(order.status)}`);
    }

    const orderDetailsStr = JSON.stringify(
      buildOrderDetails({
        merchantId: MERCHANT_ID,
        customerId: CUSTOMER_ID,
        orderId,
        amount: AMOUNT,
        mobile: MOBILE,
        email: EMAIL,
      })
    );
    const signature = generateSign(PRIVATE_KEY, orderDetailsStr);
    append(`signed orderDetails (sig length ${signature.length})`);

    return JSON.stringify({
      requestId: uuid(),
      service: FRAGMENT_SERVICE,
      payload: {
        action: FRAGMENT_ACTION,
        clientId: CLIENT_ID,
        merchantId: MERCHANT_ID,
        orderDetails: orderDetailsStr,
        signature,
        merchantKeyId: MERCHANT_KEY_ID,
      },
    });
  };

  /** Widget path: mounts HyperFragmentView with the payload. */
  const prepareFragment = async () => {
    try {
      const payload = await buildSignedPayload();
      if (!payload) return;
      setFragmentPayload(payload);
      append(`fragment payload ready (${FRAGMENT_ACTION} / ${FRAGMENT_NAMESPACE})`);
    } catch (e: any) {
      append(`ERROR preparing fragment: ${e?.message ?? String(e)}`);
    }
  };

  /**
   * Full-page path: same payload straight to process(), no fragment view.
   * If this renders and the widget does not, the fault is in the widget path.
   */
  const openPaymentPageDirect = async () => {
    try {
      const payload = await buildSignedPayload();
      if (!payload) return;
      setFragmentPayload(null); // avoid the widget drawing over the page
      HyperSdkReact.process(payload);
      append('process() called WITHOUT fragment - expecting a full-screen payment page');
    } catch (e: any) {
      append(`ERROR opening payment page: ${e?.message ?? String(e)}`);
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
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>HyperSDK - New Architecture harness</Text>
        <Text style={styles.status}>
          {initialised ? 'INITIALISED' : 'not initialised'}
        </Text>

        <View style={styles.row}>
          <Button title="1. Initiate" onPress={doInitiate} />
          <View style={styles.gap} />
          <Button
            title="2. Order + sign"
            onPress={prepareFragment}
            disabled={!initialised}
          />
          <View style={styles.gap} />
          <Button
          title="3. Payment page"
          onPress={openPaymentPageDirect}
          disabled={!initialised}
        />
        <View style={styles.gap} />
        <Button title="Status" onPress={checkStatus} />
          <View style={styles.gap} />
          <Button title="Clear" onPress={() => setLog([])} />
        </View>

        <Text style={styles.subtitle}>Events</Text>
        <View style={styles.logBox}>
          <ScrollView nestedScrollEnabled>
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
        </View>

        <Text style={styles.subtitle}>
          HyperFragmentView - {FRAGMENT_ACTION} / {FRAGMENT_NAMESPACE}
        </Text>
        {!fragmentPayload && (
          <Text style={styles.dim}>
            Not mounted yet. Run Initiate, then Order + sign. The widget will
            appear pinned at the bottom, outside this scroll area (mirrors the
            example's absolute-positioned horizontal2 container).
          </Text>
        )}
      </ScrollView>

      {fragmentPayload ? (
        <View style={styles.widgetDock}>
          <HyperFragmentView
            height={103}
            namespace={FRAGMENT_NAMESPACE}
            payload={fragmentPayload}
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
  subtitle: { fontSize: 14, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  status: { fontSize: 14, marginBottom: 12, color: '#555' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  gap: { width: 8 },
  logBox: {
    height: 200,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    backgroundColor: '#fafafa',
  },
  logLine: { fontSize: 10, fontFamily: 'Courier', marginBottom: 3, padding: 8 },
  dim: { fontSize: 11, color: '#999', padding: 8 },
  widgetDock: {
    // Mirrors the example's horizontal2: pinned outside all scroll content,
    // full width. The SDK's view manager re-asserts this view's frame every
    // frame via Choreographer, so it must not live inside a scrolling
    // ancestor or the two layout systems fight (that was the overlap).
    height: 103,
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: '#ccc',
    backgroundColor: '#fff',
  },
});
