import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { TripProvider, useTrip } from "./contexts/TripContext";
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
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
import TransactionsPage from "./pages/TransactionsPage";
import UpcomingTripsPage from "./pages/UpcomingTripsPage";
import TripsPage from "./pages/TripsPage";
import ExplorePage from "./pages/ExplorePage";
import FlightsPage from "./pages/FlightsPage";
import HotelsPage from "./pages/HotelsPage";
import ProfilePage from "./pages/ProfilePage";
import FloatingAssistant from "./components/FloatingAssistant";

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

/**
 * Unmatched routes send the visitor somewhere real rather than a blank
 * screen: signed-in users to the planner, everyone else to the landing page.
 */
const NotFound = () => {
  const token = localStorage.getItem("traveltea_token");
  return <Navigate to={token ? "/plan" : "/"} replace />;
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
      <FloatingAssistant />
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
          path="/transactions"
          element={
            <ProtectedRoute>
              <TransactionsPage />
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
        <Route
          path="/trips"
          element={
            <ProtectedRoute>
              <TripsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/explore"
          element={
            <ProtectedRoute>
              <ExplorePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/flights"
          element={
            <ProtectedRoute>
              <FlightsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hotels"
          element={
            <ProtectedRoute>
              <HotelsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
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

        {/*
          Catch-all. Without this, any unmatched URL (a typo, a stale
          bookmark) rendered a
          completely blank page with only a react-router
          "No routes matched location" warning in the console.
        */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
};

function App() {
  return (
    <AuthProvider>
      <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} />
      <TripProvider>
        <AppContent />
      </TripProvider>
    </AuthProvider>
  );
}

export default App;