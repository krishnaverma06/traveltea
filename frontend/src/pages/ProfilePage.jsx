import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  apiGetSavedTrips,
  apiUpdateProfile,
  apiUpdatePreferences,
  getToken,
} from "@/lib/api";
import { toast } from "react-toastify";
import {
  ArrowLeft,
  Plane,
  Calendar,
  MapPin,
  TrendingUp,
  Loader2,
  AlertTriangle,
} from "lucide-react";

const BUDGET_OPTIONS = [
  { value: "budget", label: "Budget" },
  { value: "mid-range", label: "Mid-Range" },
  { value: "luxury", label: "Luxury" },
];

const TRAVEL_STYLE_OPTIONS = [
  { value: "adventure", label: "Adventure" },
  { value: "relaxation", label: "Relaxation" },
  { value: "cultural", label: "Cultural" },
  { value: "business", label: "Business" },
];

const INTEREST_OPTIONS = [
  "Museums",
  "Nightlife",
  "Nature",
  "Food",
  "Shopping",
  "History",
  "Art",
];

const StatCard = ({ icon: Icon, label, value, gradient }) => (
  <Card className="p-6 bg-white border border-gray-200">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-600 font-medium">{label}</p>
        <p className="text-3xl font-bold text-gray-900">{value}</p>
      </div>
      <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
    </div>
  </Card>
);

const ProfilePage = () => {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();

  const [savedTrips, setSavedTrips] = useState([]);
  const [isLoadingTrips, setIsLoadingTrips] = useState(true);

  const [name, setName] = useState(user?.name || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [notifications, setNotifications] = useState(
    user?.notifications ?? true
  );
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [budget, setBudget] = useState(user?.preferences?.budget || "mid-range");
  const [travelStyle, setTravelStyle] = useState(
    user?.preferences?.travelStyle || "cultural"
  );
  const [interests, setInterests] = useState(user?.preferences?.interests || []);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIsLoadingTrips(false);
      return;
    }
    apiGetSavedTrips(token, { limit: 1000 })
      .then((res) => setSavedTrips(res.savedTrips || []))
      .catch(() => setSavedTrips([]))
      .finally(() => setIsLoadingTrips(false));
  }, []);

  const getTripEndDate = (trip) => {
    const start = new Date(trip.startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + (trip.totalDays || 0));
    return end;
  };

  const now = new Date();
  const completedTrips = savedTrips.filter((t) => getTripEndDate(t) < now);
  const upcomingTrips = savedTrips.filter((t) => new Date(t.startDate) >= now);

  const totalTrips = savedTrips.length;
  const daysTraveled = completedTrips.reduce(
    (sum, t) => sum + (t.totalDays || 0),
    0
  );
  const citiesVisited = new Set(
    completedTrips.flatMap((t) => t.cities?.map((c) => c.name) || [])
  ).size;
  const countriesVisited = new Set(
    completedTrips.flatMap(
      (t) => t.cities?.map((c) => c.country).filter(Boolean) || []
    )
  ).size;

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "—";

  const handleSaveProfile = async () => {
    try {
      setIsSavingProfile(true);
      const token = getToken();
      const res = await apiUpdateProfile({ name, bio, notifications }, token);
      updateUser(res.user);
      toast.success("Profile updated successfully");
    } catch (err) {
      toast.error(err.message || "Failed to update profile");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const toggleInterest = (interest) => {
    setInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    );
  };

  const handleSavePreferences = async () => {
    try {
      setIsSavingPreferences(true);
      const token = getToken();
      const res = await apiUpdatePreferences(
        { budget, travelStyle, interests },
        token
      );
      updateUser(res.user);
      toast.success("Preferences updated successfully");
    } catch (err) {
      toast.error(err.message || "Failed to update preferences");
    } finally {
      setIsSavingPreferences(false);
    }
  };

  const handleNotificationsToggle = async (checked) => {
    setNotifications(checked);
    try {
      const token = getToken();
      const res = await apiUpdateProfile({ notifications: checked }, token);
      updateUser(res.user);
    } catch (err) {
      setNotifications(!checked);
      toast.error("Failed to update notification setting");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30">
      <div className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50 shadow-lg">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/plan")}
              className="text-gray-600 hover:text-gray-900 hover:bg-white/50 backdrop-blur-sm transition-all duration-300 group"
            >
              <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform duration-300" />
              Back to Planning
            </Button>
            <div className="h-6 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              My Profile
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">
        {/* Trip Statistics */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Trip Statistics
          </h2>
          {isLoadingTrips ? (
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <StatCard
                  icon={Plane}
                  label="Total Trips"
                  value={totalTrips}
                  gradient="from-blue-500 to-blue-600"
                />
                <StatCard
                  icon={Calendar}
                  label="Days Traveled"
                  value={daysTraveled}
                  gradient="from-green-500 to-green-600"
                />
                <StatCard
                  icon={MapPin}
                  label="Cities Visited"
                  value={citiesVisited}
                  gradient="from-purple-500 to-purple-600"
                />
                <StatCard
                  icon={TrendingUp}
                  label="Countries Visited"
                  value={countriesVisited}
                  gradient="from-orange-500 to-orange-600"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-5 bg-blue-50 border border-blue-100">
                  <p className="text-sm text-blue-700 font-medium">Saved Trips</p>
                  <p className="text-2xl font-bold text-blue-900">
                    {savedTrips.length}
                  </p>
                </Card>
                <Card className="p-5 bg-green-50 border border-green-100">
                  <p className="text-sm text-green-700 font-medium">
                    Upcoming Trips
                  </p>
                  <p className="text-2xl font-bold text-green-900">
                    {upcomingTrips.length}
                  </p>
                </Card>
                <Card className="p-5 bg-purple-50 border border-purple-100">
                  <p className="text-sm text-purple-700 font-medium">
                    Completed Trips
                  </p>
                  <p className="text-2xl font-bold text-purple-900">
                    {completedTrips.length}
                  </p>
                </Card>
              </div>
            </>
          )}
        </section>

        {/* Personal Information */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Personal Information
          </h2>
          <Card className="p-6 bg-white border border-gray-200 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <Input value={user?.email || ""} disabled className="bg-gray-50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={4}
                className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Tell us a bit about yourself..."
              />
              <p className="text-xs text-gray-400 mt-1">
                {bio.length}/500 characters
              </p>
            </div>
            <Button
              onClick={handleSaveProfile}
              disabled={isSavingProfile}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            >
              {isSavingProfile ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </Card>
        </section>

        {/* Travel Preferences */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Travel Preferences
          </h2>
          <Card className="p-6 bg-white border border-gray-200 space-y-6">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Budget Preference
              </p>
              <div className="flex gap-2">
                {BUDGET_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setBudget(opt.value)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
                      budget === opt.value
                        ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg"
                        : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Travel Style
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {TRAVEL_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTravelStyle(opt.value)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
                      travelStyle === opt.value
                        ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg"
                        : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Interests</p>
              <div className="flex flex-wrap gap-2">
                {INTEREST_OPTIONS.map((interest) => (
                  <button
                    key={interest}
                    onClick={() => toggleInterest(interest)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
                      interests.includes(interest)
                        ? "bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-lg"
                        : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {interest}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleSavePreferences}
              disabled={isSavingPreferences}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            >
              {isSavingPreferences ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Save Preferences
            </Button>
          </Card>
        </section>

        {/* App Settings */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">App Settings</h2>
          <Card className="p-6 bg-white border border-gray-200 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Enable Notifications</p>
                <p className="text-sm text-gray-500">
                  Get updates about your trips and recommendations
                </p>
              </div>
              <Switch
                checked={notifications}
                onCheckedChange={handleNotificationsToggle}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Dark Mode</p>
                <p className="text-sm text-gray-500">Coming soon!</p>
              </div>
              <Switch checked={false} disabled />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <p className="text-sm text-gray-500">Member Since</p>
              <p className="text-sm font-semibold text-gray-900">{memberSince}</p>
            </div>
          </Card>
        </section>

        {/* Danger Zone */}
        <section>
          <h2 className="text-xl font-bold text-red-600 mb-4">Danger Zone</h2>
          <Card className="p-6 bg-red-50 border border-red-200">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-900">Delete Account</p>
                <p className="text-sm text-red-700 mt-1">
                  This will permanently:
                </p>
                <ul className="text-sm text-red-700 list-disc list-inside mt-1 space-y-0.5">
                  <li>Delete all your trip data</li>
                  <li>Remove your profile permanently</li>
                  <li>Cancel all upcoming trips</li>
                </ul>
              </div>
            </div>

            {!showDeleteConfirm ? (
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
                className="border-red-300 text-red-700 hover:bg-red-100"
              >
                Delete Account
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-red-900">
                  Are you absolutely sure? This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled
                    title="Disabled in demo"
                    className="bg-red-600 text-white opacity-50 cursor-not-allowed"
                  >
                    Yes, Delete My Account (Disabled in demo)
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
};

export default ProfilePage;
