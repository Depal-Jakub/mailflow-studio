import { ArrowLeft, SearchX } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../components/ui/Button";

export function NotFoundPage() {
  return (
    <div className="not-found">
      <SearchX size={34} />
      <h1>Nie znaleziono tego widoku</h1>
      <p>Adres jest nieprawidłowy albo moduł został przeniesiony.</p>
      <Link to="/">
        <Button icon={ArrowLeft} variant="primary">
          Wróć do pulpitu
        </Button>
      </Link>
    </div>
  );
}
