import { type ReactNode, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LoginPage } from "../../pages/LoginPage";
import { demoMode, supabase, supabaseConfigured } from "../../services/supabase";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!demoMode);

  useEffect(() => {
    if (demoMode || !supabase) return;
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (demoMode) return children;
  if (!supabaseConfigured || !supabase) {
    return (
      <LoginPage
        configurationError="Brakuje VITE_SUPABASE_URL lub VITE_SUPABASE_PUBLISHABLE_KEY."
      />
    );
  }
  if (loading) {
    return (
      <div className="auth-loading">
        <span />
        <strong>Sprawdzanie bezpiecznej sesji...</strong>
      </div>
    );
  }
  if (!session) return <LoginPage />;
  return children;
}
