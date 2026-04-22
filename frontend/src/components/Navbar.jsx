import { Link } from "react-router-dom";
import { Home } from "lucide-react";
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
              {/* Always-visible way back to the planning flow — e.g. right
                  after an itinerary finishes generating, so the user isn't
                  stuck relying on the (desktop-only) "Plan" link above. */}
              <Button
                variant="outline"
                asChild
                title="Back to planning"
                aria-label="Back to planning"
                className="text-black"
              >
                <Link to="/plan" className="flex items-center gap-2">
                  <Home className="w-4 h-4" />
                  <span className="hidden sm:inline">Plan a Trip</span>
                </Link>
              </Button>
              <span className="text-sm text-gray-600 hidden sm:block">
                Welcome, {user?.name}
              </span>
              <Button variant="outline" onClick={logout} className="text-black">
                Logout
              </Button>
              <Link to="/profile" className="ml-2 w-10 h-10 rounded-full overflow-hidden border-2 border-gray-200 hover:border-blue-500 transition-all flex items-center justify-center bg-gray-50 flex-shrink-0" title="Go to Profile">
                <img 
                  src={user?.avatar ? `https://api.dicebear.com/7.x/adventurer/svg?seed=${user.avatar}` : `https://api.dicebear.com/7.x/adventurer/svg?seed=${user?.name || 'Felix'}`} 
                  alt="Profile" 
                  className="w-full h-full object-cover" 
                />
              </Link>
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