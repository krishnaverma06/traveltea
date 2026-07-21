import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { TripProvider, useTrip } from "./contexts/TripContext";
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LandingPage from "./pages/LandingPage.jsx";
import TripPlannerPage from "./pages/TripPlannerPage.jsx";
import BudgetPage from "./pages/BudgetPage.jsx";
import PreferencesPage from "./pages/PreferencesPage.jsx";
import ResultsPage from "./pages/ResultsPage.jsx";
import Chat  from "./pages/Chat";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import OnboardingPage from "./pages/OnboardingPage"
import Home from "./pages/Home"
import ItineraryPage from "./pages/ItinearyPage";
import SavedTripsPage from "./pages/SavedTripsPage";
import UpcomingTripsPage from "./pages/UpcomingTripsPage";

const ProtectedRoute = ({
  children,
  condition = true,
  redirectTo = "/plan",
}) => {
  const token = localStorage.getItem("traveltea_token");

  // User is not logged in
  if (!token) {
    return <Navigate to="/" replace />;
  }

  // User skipped previous trip planning steps
  if (!condition) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
};

const PublicRoute = ({ children }) => {
  const token = localStorage.getItem("traveltea_token");

  if (token) {
    return <Navigate to="/plan" replace />;
  }

  return children;
};

// App content that has access to TripContext
const AppContent = () => {
  const { tripData } = useTrip();
   const { user } = useAuth();

  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/plan"
          element={
            <ProtectedRoute>
              <TripPlannerPage />
            </ProtectedRoute>
          }
        />
        <Route 
          path="/plan/preferences" 
          element={
            <ProtectedRoute condition={tripData?.cities?.length > 0 && tripData?.startDate}>
              <PreferencesPage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/plan/budget" 
          element={
            <ProtectedRoute condition={tripData?.people && tripData?.travelType}>
              <BudgetPage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/plan/results" 
          element={
            <ProtectedRoute
              condition={
                tripData?.people &&
                tripData?.travelType &&
                tripData?.cities?.length > 0 &&
                tripData?.startDate
              }
            >
              <ResultsPage />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/saved-trips"
          element={
            <ProtectedRoute>
              <SavedTripsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/upcoming-trips"
          element={
            <ProtectedRoute>
              <UpcomingTripsPage />
            </ProtectedRoute>
          }
        />
        {/* <Route 
          path="/plan/details" 
          element={
            <ProtectedRoute condition={tripData?.selectedTrip}>
              <TripDetailsPage />
            </ProtectedRoute>
          } 
        /> */}
         <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <Chat />
            </ProtectedRoute>
          }
        />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <OnboardingPage />
            </ProtectedRoute>
          }
        />
        <Route
        
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />

        <Route
          path="/signup"
          element={
            <PublicRoute>
              <SignupPage />
            </PublicRoute>
          }
        />
        <Route
          path="/itinerary"
          element={
            <ProtectedRoute>
              <ItineraryPage />
            </ProtectedRoute>
          }
        />

      </Routes>
    </Router>
  );
};

function App() {
  return (
    <AuthProvider>
      <TripProvider>
        <AppContent />
      </TripProvider>
    </AuthProvider>
  );
}

export default App;