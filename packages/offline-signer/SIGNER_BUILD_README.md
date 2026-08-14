# Building the TrustAnchor Signer Executable

Produces a standalone `TrustAnchor-Signer.exe` that issuers double-click to sign documents. **No Node.js or setup required on the issuer's machine.**

## Build (from `packages/offline-signer`)

```bash
npm install
npm run build:signer
```

This produces `build/TrustAnchor-Signer.exe`. Hand it to the issuer.

### If the build fails with "Not found in remote cache"

The `pkg` tool needs a pre-built Node.js binary. If it can't find one and tries to compile from source, it will fail unless you have build tools (NASM, Visual Studio Build Tools) installed.

**Fix — install the pre-built binary manually:**

```bash
# Check which version pkg wants (look at the error message for the tag, e.g. v3.5)
# Then download it manually from:
# https://github.com/nicolo-ribaudo/pkg-fetch/releases
#
# Or, install a different pkg version that has cached binaries:
npm install --save-dev @nicolo-ribaudo/pkg-fetch@3.5
npx @yao-pkg/pkg dist/sign-gui.js -t node18-win-x64 -o build/TrustAnchor-Signer.exe
```

**Alternative — use Node's built-in Single Executable (Node 20+):**

If pkg continues to fail, you can use Node's native SEA feature instead:

```bash
# 1. Build the JS
npm run build

# 2. Create the SEA config
echo {"main":"dist/sign-gui.js","output":"build/sea-prep.blob"} > sea-config.json

# 3. Generate the blob
node --experimental-sea-config sea-config.json

# 4. Copy node.exe and inject
cp "$(which node)" build/TrustAnchor-Signer.exe
npx postject build/TrustAnchor-Signer.exe NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

### Other platforms

```bash
npm run package:mac         # macOS Intel
npm run package:mac-arm     # macOS Apple Silicon
npm run package:linux       # Linux x64
```

Cross-compilation (building Windows .exe from Mac/Linux or vice versa) may require downloading the target's base binary first.

## Issuer onboarding (admin does this once)

1. Build the executable for the issuer's OS
2. Copy it to the issuer's Desktop
3. Ensure GnuPG is installed:
   - **Windows:** [Gpg4win](https://gpg4win.org)
   - **Mac:** `brew install gnupg`
   - **Linux:** `sudo apt install gnupg pcscd`
4. Test: plug in the YubiKey and run the signer

## What the issuer does each time

1. Download `unsigned_batch.json` from the portal
2. Plug in their YubiKey
3. Double-click `TrustAnchor-Signer`
4. Touch YubiKey when it blinks
5. Upload `signed_batch.json` back to the portal
