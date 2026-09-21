# HyperSDKNewArchTest

A minimal React Native app for reproducing and validating **hyper-sdk-react** against
React Native's **New Architecture** (Fabric + TurboModules).

It runs a harness that walks the full HyperSDK sequence — listener, `createHyperServices`,
signed `initiate`, order creation + signing, and a live `HyperFragmentView` payment widget —
printing every native event on screen so failures are attributable to a specific step.

Findings from this reproduction live in [`NEW_ARCH_INTEGRATION_FINDINGS.md`](./NEW_ARCH_INTEGRATION_FINDINGS.md).

## Versions

| | Version |
|---|---|
| react-native | 0.86.2 (New Architecture mandatory) |
| react | 19.2.3 |
| hyper-sdk-react | 5.0.34 (pinned exactly — the version in the merchant's original ticket) |
| HyperSDK native — iOS pod | 2.2.2.8 |
| HyperSDK native — Android | resolved by `hypersdk.plugin` |
| Node | >= 20 (20.20.2 verified) |

`newArchEnabled=true` in `android/gradle.properties`; verified live via the harness's
`Fabric: YES` line and the SDK's generated `IS_NEW_ARCHITECTURE_ENABLED = true`.

`hyper-sdk-react` is pinned **exactly** (no caret) so the reproduction stays stable — a
caret would silently resolve to 5.0.35 on a fresh install and change what is being tested.

The merchant quoted two versions: **5.0.34** in the original ticket, and **5.0.35** in their
later blank-widget reproduction. This project tracks 5.0.34. Both were verified to build on
RN 0.86.2 with the New Architecture enabled.

One consequence of staying on 5.0.34: it carries a Gradle scoping bug that 5.0.35 fixes, so
the Android build fails unless `newArchEnabled=true` is present **literally** — do not delete
that line even though React Native prints that you can. See the findings doc.

## Prerequisites

**Node 20 or newer.** Metro crashes on Node 18 with
`TypeError: configs.toReversed is not a function`.

```sh
nvm use 20.20.2
node -v   # must be >= 20
```

`launchPackager.command` spawns a fresh login shell, so `nvm use` in your current terminal
does not reach it. If Node 18 keeps coming back, check `~/.zshrc` for a hardcoded
`.nvm/versions/node/v18.*/bin` entry on `PATH` — it overrides nvm's default.

## Credentials

### 1. Runtime credentials — `credentials.local.json`

This file is **gitignored**. Create it in the project root and fill in your sandbox values.

```jsonc
{
  "merchantId": "<your sandbox merchantId>",
  "clientId":   "<your sandbox clientId>",
  "customerId": "test_customer_001",
  "environment": "sandbox",

  // Only needed to CREATE an order. Skip it by setting "orderId" below.
  "apiKey": "<sandbox API key>",
  "amount": "1.00",
  "mobile": "9999999999",
  "email":  "test@example.com",

  // Required for signing. PEM armour optional - bare base64 DER also works.
  "merchantKeyId": "<merchant key id>",
  "privateKey": "<RSA private key>",

  // Optional: reuse an EXISTING sandbox order instead of creating one.
  // When set, "apiKey" is not needed.
  "orderId": "",

  "fragmentService": "in.juspay.hyperpay",
  "fragmentAction": "paymentPage",
  "fragmentNamespace": "paymentWidget"
}
```

| Field | Needed for | Notes |
|---|---|---|
| `merchantId`, `clientId` | everything | No fallback — a missing value fails visibly in the log |
| `merchantKeyId`, `privateKey` | **signing** | Both `initiate` and the fragment payload are signed |
| `apiKey` | **creating an order** only | Not needed if you supply `orderId` |
| `orderId` | optional | An existing sandbox `order_id`; skips `/order/create` |
| `fragmentNamespace` | the widget | Must be `paymentWidget` or `quickPay` — the SDK knows no others |

Notes on the private key:

- Both PKCS#1 (`BEGIN RSA PRIVATE KEY`) and PKCS#8 (`BEGIN PRIVATE KEY`) work.
- Bare base64 with no `-----BEGIN-----` lines also works — armour is added automatically.
- In JSON, newlines inside the key must be escaped as `\n`.
- Signing happens in-app via `jsrsasign` (see `hyperApi.ts`), a JS port of the pieces of the
  official example's `HyperAPIUtils` native module. **Harness-only** — `hyper-sdk-react`
  itself does not require it.

### 2. Build-time `clientId` — a different thing

This selects which **asset bundle** is downloaded at build time, and is separate from the
runtime credentials above. It is committed, so it stays the public demo merchant `geddit`:

- `android/build.gradle` → `ext { clientId = 'geddit' }`
- `ios/MerchantConfig.txt` → `clientId = geddit`

Your build-time `clientId` must have a **published asset bundle**, or the Android build
fails at configure time with an S3 `403`. Check before changing it:

```sh
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://public.releases.juspay.in/hyper-sdk/in/juspay/merchants/hyper.assets.<clientId>/sdk_build_config.json"
```

`200` means published. `403` is indistinguishable from "not found" — a nonsense id returns
the same — so treat it as "no bundle for this id". Runtime credentials may differ from the
build-time `clientId`.

## Platform setup

Already applied in this repo, recorded here because none of it is obvious.

### Android — Jetifier is required

`hyperupi` pulls in NPCI's `pinactivitycomponent`, which still references the pre-AndroidX
`android.support.v7` library. Without Jetifier the app crashes on launch with
`NoClassDefFoundError: android/support/v7/app/AppCompatActivity`.

```properties
# android/gradle.properties
android.enableJetifier=true
android.jetifier.ignorelist=react-android,hermes-android
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m
```

The ignorelist is not optional — Jetifier runs out of heap transforming the React Native
AARs, which need no rewriting anyway. The official example ships the same line.

Alternative, if you do not need UPI: `excludedMicroSDKs = ['hyperupi']` in the root
`build.gradle`.

### iOS — asset provisioning

`ios/Podfile` runs HyperSDK's `Fuse.rb` in `post_install`, which downloads the SDK assets
**and** the `VerifyHyperAssets.h` header the framework's public umbrella header imports.
Without it the build fails with `'HyperSDK/VerifyHyperAssets.h' file not found`.

Fuse needs `ios/MerchantConfig.txt` to exist. When it is missing, Fuse prints one easily
missed line, exits 0, and **deletes `Pods/HyperSDK/`** — so re-run `pod install` after fixing.

### iOS — AppDelegate conformance

`AppDelegate.swift` implements `HyperSdkReactDelegate.getReactNativeFactory()`, required on
RN >= 0.78 with a Swift AppDelegate so the SDK can render merchant views inside its payment
page.

## Running

```sh
npm install
nvm use 20.20.2
npm start -- --reset-cache      # credentials.local.json is bundled; a plain restart misses edits
```

Then, in a second terminal:

```sh
npm run ios       # or: npm run android
```

For iOS, run `pod install --project-directory=ios` first if pods are stale.

## Using the harness

Toggle to **Show HyperSDK Test**, then:

1. **Initiate** — `createHyperServices()`, signs the initiate payload, calls
   `initiate()` on `in.juspay.hyperpay`. Wait for `initiate_result`; status flips to
   `INITIALISED`.
2. **Order + sign** — creates (or reuses) a sandbox order, signs `orderDetails`, and builds
   the fragment payload.
3. The **HyperFragmentView** mounts once a payload exists and renders the payment widget.

The event panel logs every native event. Useful signals:

| What you see | Meaning |
|---|---|
| `Fabric: YES` | New Architecture is live |
| `errorCode: "JP_003"` | Unknown action — the payload's `action` is not a real one |
| A **red** box with text | Fabric fell back to `RCTUnimplementedNativeComponentView` |
| A plain **empty** box | Component resolved fine; `process` drew nothing (check `process_result`) |

The widget only mounts after a payload exists, mirroring the official example
(`ProcessScreen.tsx:944`). `HyperSdkReact.terminate()` runs on unmount — HyperServices is a
native singleton that otherwise keeps drawing over the next screen.

## Files

| File | Purpose |
|---|---|
| `TestHyperSDK.tsx` | The harness |
| `hyperApi.ts` | Order creation + RSA signing (JS port of the example's `HyperAPIUtils`) |
| `credentials.local.json` | Your sandbox credentials — **gitignored** |
| `NEW_ARCH_INTEGRATION_FINDINGS.md` | What reproduced, what did not, and why |
