import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useAppState } from "../../lib/AppState";

const icons = {
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
};

export function ToastViewport() {
  const { toasts, dismissToast } = useAppState();

  return (
    <div aria-live="polite" className="toast-viewport">
      {toasts.map((toast) => {
        const Icon = icons[toast.tone];
        return (
          <article className={`toast toast--${toast.tone}`} key={toast.id}>
            <Icon aria-hidden="true" size={19} />
            <div>
              <strong>{toast.title}</strong>
              <p>{toast.message}</p>
            </div>
            <button
              aria-label="Zamknij komunikat"
              onClick={() => dismissToast(toast.id)}
              type="button"
            >
              <X size={15} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

