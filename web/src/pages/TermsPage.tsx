import { Link } from 'react-router-dom';

export function TermsPage() {
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--surface)' }}>
      <div className="doc">
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--text-2)' }}>
          <img src="/favicon.svg" alt="" width={32} height={32} /> PhoneMail
        </Link>
        <h1>PhoneMail Terms of Service</h1>
        <p>Last updated: September 2026. These terms were written for the AlphaStack 7-Day Buildathon demo of PhoneMail.</p>
        <h2>1. Your account</h2>
        <p>
          PhoneMail gives every phone number an email address such as <b>9876543210@phonemail.com</b>. You can create your account from the Android app,
          this website, the registration portal, by calling our toll-free number and pressing 1, or by sending us an SMS. You prove that the number is yours
          with a one-time password (OTP) sent by SMS. Keep your phone and codes safe: anyone who can receive SMS on your number can access your mailbox.
        </p>
        <h2>2. SMS notifications</h2>
        <p>
          If you don't use the PhoneMail app, we send you an SMS when an email arrives: “You have received an email from &lt;Sender&gt;. Subject: &lt;Subject&gt;.”
          You can switch these off any time under Settings → General. Carrier charges may apply.
        </p>
        <h2>3. Acceptable use</h2>
        <p>Don't use PhoneMail to send spam, malware, or content that is illegal or harmful, and don't impersonate other people. We may suspend accounts that do.</p>
        <h2>4. Privacy</h2>
        <p>
          We store your phone number, profile details and the emails you send and receive so that the service works. The Android app can match your contacts
          with PhoneMail users; contacts are used only for that match and are not stored. We never sell your data.
        </p>
        <h2>5. Deleting your account</h2>
        <p>You can delete your account from Settings. Your mailbox, aliases and sessions are removed immediately.</p>
        <h2>6. No warranty</h2>
        <p>PhoneMail is a demonstration project provided “as is”, without warranties of any kind.</p>
        <p>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
