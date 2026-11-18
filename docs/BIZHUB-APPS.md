# Nexzek BizHub desktop and Android

These clients connect to https://nexzekbizhub.vercel.app. They use separate app identities and browser profiles from the existing E-Edge clients. Updates and synchronized company records use the same central application and Supabase database.

Windows: launch Nexzek.BizHub.exe on 64-bit Windows. Microsoft Edge WebView2 Runtime is required. The executable is not publisher-signed; no signing certificate has been supplied.

Android: install Nexzek-BizHub.apk on Android 8 or newer with an updated Android System WebView. The published APK is signed locally with the retained distribution identity; no signing credential is sent to GitHub. A Play Console bundle can be commissioned separately. No store submission is claimed.

Prepare offline use while connected: sign in, open company Commerce & inventory, select Prepare this device and set an offline passphrase. Open the offline workspace before disconnecting. Saved products, stock adjustments and order progress can synchronize after reconnecting, while the app is open and unlocked. Payments and new sign-ins require a connection. Never uninstall or clear app storage while unsynchronized changes remain.

The clients do not contain database service keys, user passwords or payment credentials. Browser/OS storage protects account sessions; the offline copy and queue use passphrase encryption. Keep the private distribution signing key safe for future compatible Android updates.
