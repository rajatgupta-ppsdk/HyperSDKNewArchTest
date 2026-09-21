/**
 * JS port of the pieces of the official example's HyperAPIUtils native module
 * that we need to build a valid HyperFragmentView payload.
 *
 * Ported to JS rather than Objective-C/Java so it needs no Xcode project or
 * Gradle changes and works identically on both platforms.
 *
 *   - createOrder()   <- HyperAPIUtils.generateOrder  (plain HTTP POST)
 *   - generateSign()  <- HyperAPIUtils.generateSign   (RSA-SHA256, PKCS1v15, base64)
 */

import { KEYUTIL, KJUR, hextob64, utf8tob64, RSAKey } from 'jsrsasign';

const SANDBOX_BASE = 'https://sandbox.juspay.in';

export const getTimestamp = () => new Date().getTime().toString();

export const generateOrderId = () =>
  'hyperOrder-' +
  Math.floor(Math.random() * 10000) +
  '-' +
  Math.random().toString(36).slice(2, 8);

/** RSA-SHA256 (PKCS#1 v1.5) over the UTF-8 payload, base64-encoded. */
export const generateSign = (privateKeyPem: string, payloadString: string) => {
  const trimmed = (privateKeyPem || '').trim();
  if (!trimmed) {
    throw new Error('privateKey is empty');
  }
  // KEYUTIL needs PEM armour. Merchant keys are often distributed as bare
  // base64 DER, so add the armour when it is missing. PKCS#1 and PKCS#8 use
  // different headers and only the key itself says which it is, so try both -
  // the example's native module did the equivalent by sniffing the DER.
  let key;
  if (trimmed.includes('-----BEGIN')) {
    key = KEYUTIL.getKey(trimmed);
  } else {
    const body = trimmed.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n');
    const armour = (label: string) =>
      `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
    try {
      key = KEYUTIL.getKey(armour('RSA PRIVATE KEY')); // PKCS#1
    } catch {
      key = KEYUTIL.getKey(armour('PRIVATE KEY')); // PKCS#8
    }
  }
  const sig = new KJUR.crypto.Signature({ alg: 'SHA256withRSA' });
  sig.init(key as RSAKey);
  sig.updateString(payloadString);
  return hextob64(sig.sign());
};

export interface InitiateSignaturePayload {
  merchant_id: string;
  customer_id: string;
  timestamp: string;
}

/**
 * The PP flow signs {merchant_id, customer_id, timestamp} and passes the
 * string + signature into initiate (example Utils.tsx generatePPInitiatePayload).
 */
export const buildInitiateSignaturePayload = (opts: {
  merchantId: string;
  customerId: string;
}): InitiateSignaturePayload => ({
  merchant_id: opts.merchantId,
  customer_id: opts.customerId,
  timestamp: getTimestamp(),
});

export interface OrderDetails {
  merchant_id: string;
  customer_id: string;
  order_id: string;
  amount: string;
  mobile_number: string;
  customer_email: string;
  timestamp: string;
  // Required for the paymentWidget namespace - the official example signs
  // this into orderDetails (ProcessScreen.tsx:811) or the widget has nothing
  // to render.
  features: { paymentWidget: { enable: boolean } };
}

export const buildOrderDetails = (opts: {
  merchantId: string;
  customerId: string;
  orderId: string;
  amount: string;
  mobile: string;
  email: string;
}): OrderDetails => ({
  merchant_id: opts.merchantId,
  customer_id: opts.customerId,
  order_id: opts.orderId,
  amount: opts.amount,
  mobile_number: opts.mobile,
  customer_email: opts.email,
  timestamp: getTimestamp(),
  features: { paymentWidget: { enable: true } },
});

/**
 * POST /order/create. Mirrors HyperAPIUtils.generateOrder, including the
 * `version: 2018-07-01` header and `options.get_client_auth_token=true`.
 * Basic auth is the API key as the username with an empty password.
 */
export const createOrder = async (opts: {
  apiKey: string;
  orderId: string;
  amount: string;
  customerId: string;
  mobile: string;
  email: string;
}): Promise<Record<string, unknown>> => {
  if (!opts.apiKey) {
    throw new Error('apiKey is empty - set it in credentials.local.json');
  }

  const body = [
    `customer_id=${encodeURIComponent(opts.customerId)}`,
    `mobile_number=${encodeURIComponent(opts.mobile)}`,
    `email_address=${encodeURIComponent(opts.email)}`,
    `amount=${encodeURIComponent(opts.amount)}`,
    `order_id=${encodeURIComponent(opts.orderId)}`,
    'options.get_client_auth_token=true',
  ].join('&');

  // utf8tob64 avoids depending on a global btoa/Buffer, neither of which is
  // guaranteed across Hermes versions.
  const basic = utf8tob64(`${opts.apiKey}:`);

  const res = await fetch(`${SANDBOX_BASE}/order/create`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      version: '2018-07-01',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`order/create returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !json.status) {
    throw new Error(`order/create failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return json;
};
