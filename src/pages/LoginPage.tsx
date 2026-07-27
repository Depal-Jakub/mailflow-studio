import { type FormEvent, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { FormField } from "../components/ui/FormField";
import { supabase } from "../services/supabase";

export function LoginPage({
  configurationError,
}: {
  configurationError?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(configurationError ?? "");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) setError("Nieprawidłowy e-mail lub hasło.");
    setLoading(false);
  };

  const resetPassword = async () => {
    if (!supabase || !email) {
      setError("Najpierw wpisz adres e-mail.");
      return;
    }
    setLoading(true);
    setError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/settings` },
    );
    if (resetError) setError(resetError.message);
    else setResetSent(true);
    setLoading(false);
  };

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand">
          <span>MF</span>
          <div>
            <strong>MailFlow Studio</strong>
            <small>Automation intelligence</small>
          </div>
        </div>
        <div className="login-promise">
          <span className="login-eyebrow">Bezpieczne centrum operacyjne</span>
          <h1>Wiadomości, reguły i automatyzacje pod pełną kontrolą.</h1>
          <p>
            Jedno miejsce do klasyfikacji poczty, scrapingu, kontroli jakości
            i wysyłki przez zatwierdzone konta.
          </p>
        </div>
        <ul className="login-proof-list">
          <li>
            <CheckCircle2 size={18} />
            Role i dostęp rozdzielone dla każdej organizacji
          </li>
          <li>
            <CheckCircle2 size={18} />
            Szyfrowane sekrety SMTP, IMAP i OAuth
          </li>
          <li>
            <CheckCircle2 size={18} />
            Pełny dziennik zmian i wykonywanych reguł
          </li>
        </ul>
        <div className="login-security">
          <ShieldCheck size={20} />
          <span>
            <strong>Warstwa RLS i szyfrowanie AES-256-GCM</strong>
            <small>Dane organizacji są od siebie odseparowane.</small>
          </span>
        </div>
      </section>

      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-icon">
            <LockKeyhole size={25} />
          </div>
          <span className="login-eyebrow">Panel administratora</span>
          <h2>Zaloguj się do MailFlow</h2>
          <p>Użyj konta zaproszonego przez administratora organizacji.</p>

          <form onSubmit={signIn}>
            <FormField label="Adres e-mail">
              <div className="input-with-icon">
                <Mail size={17} />
                <input
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@firma.pl"
                  required
                  type="email"
                  value={email}
                />
              </div>
            </FormField>
            <FormField label="Hasło">
              <div className="input-with-icon">
                <KeyRound size={17} />
                <input
                  autoComplete="current-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Wpisz hasło"
                  required
                  type="password"
                  value={password}
                />
              </div>
            </FormField>

            {error ? <div className="login-alert">{error}</div> : null}
            {resetSent ? (
              <div className="login-success">
                Link do ustawienia nowego hasła został wysłany.
              </div>
            ) : null}

            <Button
              disabled={loading || Boolean(configurationError)}
              icon={ArrowRight}
              type="submit"
              variant="primary"
            >
              {loading ? "Logowanie..." : "Zaloguj się"}
            </Button>
            <button
              className="login-reset"
              disabled={loading || Boolean(configurationError)}
              onClick={resetPassword}
              type="button"
            >
              Nie pamiętam hasła
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
