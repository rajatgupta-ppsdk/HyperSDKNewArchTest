# HyperSDK + React Native New Architecture — Final Findings

**RN** 0.86.2 · **hyper-sdk-react** 5.0.34 (pinned) · **newArchEnabled** `true` · **Node** 20.20.2
**Reference:** `juspay/hyper-sdk-react` @ `e86e17b` (5.0.35), `example/`

> **On versions.** The merchant cited two: **5.0.34** in the original ticket, and **5.0.35**
> in their later blank-widget reproduction. This project pins **5.0.34** exactly, matching
> the original report. Both were verified to build on RN 0.86.2 with the New Architecture
> enabled (iOS `** BUILD SUCCEEDED **`, Android `BUILD SUCCESSFUL`). The one behavioural
> difference between them is defect **A** below, which 5.0.35 fixes.

---

## Verdict

**hyper-sdk-react 5.0.34 is compatible with React Native 0.86.2 New Architecture.**
Both platforms build; the reported blocking issues do not reproduce.

```
Android:  BUILD SUCCESSFUL  ->  android/app/build/outputs/apk/debug/app-debug.apk
iOS:      ** BUILD SUCCEEDED **   (xcodebuild, Debug, iOS Simulator)
```

Proof New Arch was actually on, from the SDK's own generated
`in/juspay/hypersdkreact/BuildConfig.java`:

```java
public static final boolean IS_NEW_ARCHITECTURE_ENABLED = true;
public static final String  REACT_NATIVE_VERSION = "0.86.2";
```

What blocked us initially was **configuration**, not SDK incompatibility — plus one real
Gradle bug (below).

---

## NOT real — claims that did not survive testing

### 1. "Android references `ReactNativeHost`/`ReactInstanceManager`, unsupported under New Arch"

Both classes **exist** in `react-android:0.86.2`. Decompiled from the resolved artifact:

```
$ javap com/facebook/react/ReactApplication.class
public default com.facebook.react.ReactNativeHost getReactNativeHost();
public default com.facebook.react.ReactHost getReactHost();
```

`getReactNativeHost()` is a deprecated default that **throws at runtime**:

```
$ javap -c com/facebook/react/ReactApplication.class
ldc "You should not use ReactNativeHost directly in the New Architecture"
athrow
```

It can never be a *compile* error. And the call site is unreachable —
`HyperSdkReactModule.java:413` gates it on the RN version:

```java
return major > 0 || (major == 0 && minor >= 82);   // 0.86.2 -> 86 >= 82 -> true
```

so `createMerchantView` (line 324) skips the legacy block entirely and takes
`ReactHost.createSurface()` instead. **Line 330 is dead code on RN >= 0.82.**

### 2. "Missing `ReactNativeApplicationEntryPoint`" (issue #132)

Present and working on 0.86.2. `MainApplication.kt:7` imports it and compiles:

```
$ javap -c .../MainApplication.class
invokestatic com/facebook/react/ReactNativeApplicationEntryPoint.loadReactNative
```

That report was against RN 0.82.

### 3. "iOS `HyperFragmentView` relies on `dispatchViewManagerCommand`, which doesn't fire under Fabric"

Out of date for 5.0.34. `HyperFragmentView.tsx:33-56` gates the command dispatch behind
`if (!newArchEnabled)`, and `:78-87` passes `ns`/`payload` as **props** under Fabric. The
native side implements them at `HyperSdkReact.mm:453-461` via `RCT_CUSTOM_VIEW_PROPERTY`.

*Caveat: proven to compile, not exercised at runtime. See "Still open".*

### 4. "HyperSDK iOS framework is broken — `VerifyHyperAssets.h` missing"

**My own error mid-investigation.** That header is downloaded by Fuse
(`FuseRemote.rb:414`) and installed into both xcframework slices (`:241/:243`). It was
missing because our Podfile lacked the required `post_install` hook. Not an SDK defect.

### 5. The 66 `cannot find symbol` errors for `in.juspay.*`

Artifacts of my own edits to `node_modules/hyper-sdk-react/android/build.gradle`
(disabling `hypersdk.plugin`, dropping `hypercheckoutlite`). Reverted; not a real finding.

---

## REAL — confirmed defects

### A. Gradle scoping bug: build fails unless `newArchEnabled=true` is set literally

| `gradle.properties` | Result |
|---|---|
| `newArchEnabled=true` | BUILD SUCCESSFUL |
| `newArchEnabled=false` | **BUILD FAILED** |
| line removed — *what RN 0.82+ tells you to do* | **BUILD FAILED** |

```
A problem occurred evaluating project ':hyper-sdk-react'.
> Could not get unknown property 'rnVersion' for project ':hyper-sdk-react'
```

**Cause** — `hyper-sdk-react/android/build.gradle:62-78`:

```groovy
def rnVersion = getRNVersion()          // script-LOCAL variable

def isNewArchitectureEnabled() {
    if (rootProject.hasProperty("newArchEnabled")
        && rootProject.getProperty("newArchEnabled") == "true") {
        return true                     // short-circuits before touching rnVersion
    }
    def version = rnVersion.replaceAll(/[^0-9.]/, "")   // MissingPropertyException
```

`def` at script scope is a local; a method in the same script cannot resolve it, so Groovy
falls back to a project-property lookup and throws. **Masked only when the flag is literally
`true`**, because the early `return` never reaches that line.

**Why it matters:** RN 0.86.2 explicitly prints *"You can remove the line from your
`gradle.properties` file."* Following React Native's own advice breaks the build, with an
error naming neither the SDK nor the architecture. **This is a plausible root cause behind
some reports on issues #132 / #144** — it presents as "New Arch incompatibility" but is a
one-line Gradle bug.

**Fix — verified working.** Parameterise it:

```groovy
def isNewArchitectureEnabled(String rnVersion) { ... }
// and all three call sites: isNewArchitectureEnabled(rnVersion)
```

Applied to our `node_modules` copy, with `newArchEnabled` **removed entirely**:

```
BUILD SUCCESSFUL in 2s
IS_NEW_ARCHITECTURE_ENABLED = true      // correctly derived from the version fallback
```

The identical fix is already present (uncommitted) in the local clone at
`~/Documents/repos/hyper-sdk-react`.

**FIXED UPSTREAM IN 5.0.35.** Verified: `android/build.gradle:62` changed
`def rnVersion = ...` -> `ext.rnVersion = ...`, making it a project extension property that
the method *can* resolve. Stock, unmodified 5.0.35 with `newArchEnabled` removed entirely:

```
BUILD SUCCESSFUL in 13s
```

So this defect affects **5.0.34 only**. The fix for a merchant on 5.0.34 is simply to
upgrade to 5.0.35 — no patch required.

**Workaround if pinned to 5.0.34:** keep `newArchEnabled=true` explicitly, despite RN
saying to remove it.

### B. `hyperSDKVersion` override is upgrade-only

`android/build.gradle` pins `hyperSDKVersion = "2.2.2-rc.02"`, but the build logs:

```
Ignoring the overriden SDK version present in root build.gradle (2.2.2-rc.02),
as there is a newer version present in the SDK (2.2.4-rc.01).
```

`getHyperSDKVersion()` takes `mostRecentVersion([rootVersion, default])` — you can only move
**forward**, never pin down. Answers the merchant question "can we override
`hyperSDKVersion`?": yes, but upward only.

### C. Example app's repositories block breaks on RN 0.86.2

`example/android/build.gradle` declares `allprojects.repositories` with only the two Juspay
Maven URLs. Adding that block **overrides** the settings-level repositories, so on 0.86.2:

```
Could not resolve org.jetbrains.kotlin:kotlin-stdlib:2.1.20
```

Works on the example's RN 0.79.7; must restate `google()` / `mavenCentral()` on 0.86.2.

### D. Fuse fails silently without `MerchantConfig.txt`

Missing config produces one easily-missed line during `pod install`, then a confusing compile
error much later (`'HyperSDK/VerifyHyperAssets.h' file not found`). Fuse exits 0 and the
Podfile's `if system(...)` swallows the result. Its cleanup also **deletes `Pods/HyperSDK/`**
on failure, so you must re-run `pod install` after fixing.

### E. Latent ordering bug (unreachable on RN >= 0.82)

`HyperSdkReactModule.java:330` calls `getReactNativeHost()` *before* the `newArchEnabled`
check on line 333. Anyone force-enabling New Arch on RN < 0.82 hits the throwing default.

---

## Required setup (what actually unblocked us)

### Node >= 20

```
TypeError: configs.toReversed is not a function   (metro-config/src/loadConfig.js:202)
```

`Array.prototype.toReversed` needs Node 20+. Note `~/.zshrc` may hardcode a Node path that
overrides `nvm`, and `launchPackager.command` spawns a fresh login shell that ignores
`nvm use`.

### Android — `android/build.gradle`

```gradle
ext {
    clientId = 'geddit'          // must have PUBLISHED assets
    hyperSDKVersion = "2.2.2-rc.02"
    excludedMicroSDKs = []
}
allprojects {
    repositories {
        google(); mavenCentral()                            // required on 0.86.2 (see C)
        maven { url "https://maven.juspay.in/hyper-sdk/" }
        maven { url "https://maven.getsimpl.com" }
    }
}
```

No `in.juspay:hypersdk.plugin` classpath needed in the root buildscript — the library
declares its own.

**On `clientId`:** `hypersdk.plugin` fetches merchant asset config at configure time.

```
hyper.assets.geddit -> 200        hyper.assets.ackopp -> 403
```

The 403 is S3 `AccessDenied`, **indistinguishable from 404** — a nonsense id returns
byte-identical output, and library artifacts on the same host return 200. So `ackopp` simply
has no published asset bundle. That is a Juspay provisioning question, not a config error.

### iOS

`ios/MerchantConfig.txt`:

```
clientId = geddit
```

`ios/Podfile`, inside `post_install`:

```ruby
fuse_path = "./Pods/HyperSDK/Fuse.rb"
clean_assets = true
if File.exist?(fuse_path)
  if system("ruby", fuse_path.to_s, clean_assets.to_s)
  end
end
```

---

## Versions

| | Version |
|---|---|
| react / react-native | 19.2.3 / 0.86.2 |
| hyper-sdk-react | 5.0.34 (npm `latest` 5.0.35) |
| HyperSDK native — Android | **2.2.4-rc.01** |
| HyperSDK native — iOS pod | **2.2.2.8** |
| Node / Java / Xcode / CocoaPods | 20.20.2 / 17.0.16 / 26.2 / 1.16.2 |

New Arch support is **not new** — it predates 5.0.34:

| Commit | First release |
|---|---|
| `f841c77` new arch merchantView, backward compatible | **v3.0.52** |
| `933e2ef` fix `createSurface` params | **v3.0.53** |
| `0d726cd` compatibility with new RN version | **v5.0.10** |

Upgrading 5.0.34 -> 5.0.35 is cheap but is not the fix.

---

## Still open

The iOS Fabric `HyperFragmentView` **runtime** path is unexercised — we proved it compiles,
not that checkout renders. The shared instance variables in `HyperSdkReact.mm:471-493`
(`_currentNamespace` / `_currentPayload` / `_currentView`) remain a plausible multi-instance
hazard under Fabric.

**If the merchant's symptom is a blank checkout rather than a failed build, that is a
different bug from the one reported, and it is still open.** Worth asking Mealawe for their
exact error text before filing.

---

## Fixes applied

Staged in `~/Documents/repos/hyper-sdk-react2` (clean 5.0.35 clone), not committed:

| # | Defect | Status |
|---|---|---|
| A | `rnVersion` Gradle scoping | **Already fixed in 5.0.35** via `ext.rnVersion`. No change needed — verified by building stock 5.0.35 with the flag removed. |
| E | `getReactNativeHost()` called before the arch check | **Still present in 5.0.35.** Fixed: hoist the `newArchEnabled` branch above the `reactInstanceManager` block. Compile-verified; path unreachable on RN >= 0.82 so runtime untested. |
| — | `ReactHost` hard compile dependency | Already fixed in 5.0.35 (reflective `getReactHostOrInstanceManager()` + reflective `createSurface`). |

### Considered and rejected

**Example `allprojects.repositories` missing `google()`/`mavenCentral()`** — not a defect in
the SDK. It surfaced only because *this investigation* copied that block into an RN 0.86.2
project, where it overrides the settings-level repositories. The example app is not broken on
its own RN 0.79.7, and "it would break after an upgrade" was never tested. Belongs in
integration docs for RN 0.82+ merchants, not as a code change.

**Fuse silent failure in `example/ios/Podfile`** — real DX problem (it cost this
investigation a wrong "broken framework" conclusion), but it is a build-ergonomics issue, not
one of the reported defects. Left out to keep the change focused.

## Answer to "is there a newer build that resolves this?"

**Yes — for the Gradle defect.** 5.0.34 -> 5.0.35 fixes it outright. That is a concrete,
verified reason for a merchant on 5.0.34 to upgrade.

It does **not** change the New Architecture story: 5.0.34 already builds fine on RN 0.86.2
with `newArchEnabled=true` set explicitly, and the `ReactNativeHost` code path is
version-gated off on RN >= 0.82 in both releases.

## Still open

The iOS Fabric `HyperFragmentView` **runtime** path remains unexercised — compilation is
proven, rendering is not. `HyperSdkReact.mm:471-493` keeps `_currentNamespace` /
`_currentPayload` / `_currentView` as shared instance variables, a plausible multi-instance
hazard under Fabric.

**If the merchant's symptom is a blank checkout rather than a failed build, nothing here
addresses it.** Get their exact error text first.

## Remaining Juspay-side action

Publish asset config for the merchant's sandbox `clientId`, or tell them which id to use.
`hyper.assets.geddit` -> 200; `hyper.assets.ackopp` -> 403.
