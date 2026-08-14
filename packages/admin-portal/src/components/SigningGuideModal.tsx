/**
 * SigningGuideModal.tsx — explains offline signing to an issuer.
 * The issuer has a YubiKey and a downloaded file. That's it.
 */
import React from 'react';
import { IconClose } from './icons';
import './SigningGuideModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SigningGuideModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="sgm-overlay" onClick={onClose}>
      <div className="sgm-modal" onClick={(e) => e.stopPropagation()}>
        <button className="sgm-close" onClick={onClose} aria-label="Close">
          <IconClose size={20} />
        </button>

        <div className="sgm-header">
          <div className="sgm-icon">🔐</div>
          <h2 className="sgm-title">How Document Signing Works</h2>
        </div>

        <div className="sgm-body">

          <section className="sgm-section">
            <h3>What is this?</h3>
            <p>
              Every document you issue through TrustAnchor carries a
              <strong> digital signature</strong> — an unforgeable seal that proves
              it came from your institution and hasn't been tampered with.
            </p>
            <p>
              This signature is created using a small USB device called a
              <strong> YubiKey</strong> that your administrator gave you.
              The signing happens entirely on your computer — the private
              signing key never touches the internet, so even if someone
              hacked this entire website, they still couldn't forge your documents.
            </p>
          </section>

          <section className="sgm-section">
            <h3>Your YubiKey</h3>
            <p>
              Your YubiKey is the small USB device (about the size of a house key)
              that your administrator gave you when your account was set up. It has
              a metal contact you'll need to touch during signing.
            </p>
            <p>
              The signing key lives <strong>inside</strong> this device and can never
              be copied or extracted — not by you, not by your computer, not by anyone.
              The YubiKey performs the signing internally and only outputs the result.
            </p>
            <div className="sgm-callout">
              <strong>Don't have a YubiKey?</strong> Contact your administrator.
              You cannot sign documents without one.
            </div>
          </section>

          <section className="sgm-section">
            <h3>What you need</h3>
            <div className="sgm-checklist">
              <div className="sgm-check-item">
                <span className="sgm-check-icon">1</span>
                <div>
                  <strong>Your YubiKey</strong>
                  <p>The USB device your administrator gave you.</p>
                </div>
              </div>
              <div className="sgm-check-item">
                <span className="sgm-check-icon">2</span>
                <div>
                  <strong>TrustAnchor Signer app</strong>
                  <p>
                    A small application your administrator installed on your computer
                    during onboarding. Look for <strong>TrustAnchor-Signer</strong> on your
                    Desktop or in your Applications folder.
                  </p>
                </div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 12 }}>
              That's it — no other software, no accounts, no setup needed.
            </p>
          </section>

          <section className="sgm-section">
            <h3>How to sign your documents</h3>

            <div className="sgm-step">
              <div className="sgm-step-num">1</div>
              <div>
                <strong>Complete the issuance steps on the portal</strong>
                <p>
                  The portal will download a file called <code>unsigned_batch.json</code>
                  to your computer (usually into your Downloads folder).
                </p>
              </div>
            </div>

            <div className="sgm-step">
              <div className="sgm-step-num">2</div>
              <div>
                <strong>Plug in your YubiKey</strong>
                <p>Insert it into any USB port on your computer.</p>
              </div>
            </div>

            <div className="sgm-step">
              <div className="sgm-step-num">3</div>
              <div>
                <strong>Open the TrustAnchor Signer app</strong>
                <p>
                  <strong>On Windows:</strong> Double-click <code>TrustAnchor-Signer.exe</code>
                </p>
                <p>
                  <strong>On Mac:</strong> Double-click <code>TrustAnchor-Signer</code>
                  (if Mac says "unidentified developer", right-click → Open → Open)
                </p>
                <p>A window opens and the app starts automatically.</p>
              </div>
            </div>

            <div className="sgm-step">
              <div className="sgm-step-num">4</div>
              <div>
                <strong>The app finds your file automatically</strong>
                <p>
                  It looks in your Downloads folder for <code>unsigned_batch.json</code>.
                  If it finds it, just press Enter to confirm. If it doesn't find it,
                  type the location of the file when it asks.
                </p>
              </div>
            </div>

            <div className="sgm-step">
              <div className="sgm-step-num">5</div>
              <div>
                <strong>Touch your YubiKey when it blinks</strong>
                <p>The app will say "Signing document 1 of N..." and then:</p>
                <ol className="sgm-substeps">
                  <li>If your YubiKey has a PIN, type it when asked and press Enter</li>
                  <li>Your <strong>YubiKey starts blinking</strong> — it's waiting for permission</li>
                  <li><strong>Touch the metal contact on your YubiKey</strong></li>
                  <li>It signs that document, then moves to the next one</li>
                  <li>It may blink again for each document — touch it each time</li>
                </ol>
              </div>
            </div>

            <div className="sgm-step">
              <div className="sgm-step-num">6</div>
              <div>
                <strong>Upload the signed file</strong>
                <p>
                  When the app says "All documents signed successfully!", go back
                  to this website and upload the <code>signed_batch.json</code> file.
                  It's saved in the same folder as the unsigned file (usually Downloads).
                </p>
              </div>
            </div>
          </section>

          <section className="sgm-section">
            <h3>Something went wrong?</h3>
            <div className="sgm-faq">
              <strong>"Can't find TrustAnchor Signer on my computer"</strong>
              <p>Your administrator needs to install it for you. Contact them.</p>
            </div>
            <div className="sgm-faq">
              <strong>"YubiKey not detected"</strong>
              <p>Unplug it and plug it back in firmly. Try a different USB port.
              If you're using a USB hub, plug directly into the computer.</p>
            </div>
            <div className="sgm-faq">
              <strong>"Wrong PIN"</strong>
              <p>Contact your administrator for the correct PIN. After 3 wrong
              attempts, the YubiKey locks — your admin will need to reset it.</p>
            </div>
            <div className="sgm-faq">
              <strong>"Mac won't open the app" / "Windows blocked the app"</strong>
              <p>On Mac: right-click the app → Open → click Open again.
              On Windows: click "More info" → "Run anyway".</p>
            </div>
            <div className="sgm-faq">
              <strong>I lost my YubiKey</strong>
              <p>Contact your administrator immediately. They will revoke the old
              key and set up a new one.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
