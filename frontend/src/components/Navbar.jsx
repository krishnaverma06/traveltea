import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  return (
    <header className="w-full border-b bg-background">
      <nav className="max-w-7xl mx-auto flex items-center justify-between px-6 md:px-10 py-4">
        {/* Logo / Brand Name */}
        <Link to="/" className="text-xl md:text-2xl font-bold text-black">
          TravelTea
        </Link>

        {/* Navigation Links */}
        {isAuthenticated && (
          <div className="hidden md:flex items-center gap-6">
            <Link
              to="/plan"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Plan
            </Link>
            <Link
              to="/saved-trips"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Saved Trips
            </Link>
          </div>
        )}

        {/* Auth Buttons */}
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              <span className="text-sm text-gray-600 hidden sm:block">
                Welcome, {user?.name}
              </span>
              <Button variant="outline" onClick={logout} className="text-black">
                Logout
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" asChild>
                <Link to="/login" className="text-black">
                  Login
                </Link>
              </Button>
              <Button asChild className="bg-black">
                <Link className="text-white" to="/signup">
                  Sign Up
                </Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}