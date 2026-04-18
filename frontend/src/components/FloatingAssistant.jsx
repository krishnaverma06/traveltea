import React, { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import ChatDrawer from './ChatDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';

export default function FloatingAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const [showLabel, setShowLabel] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const timer = setTimeout(() => setShowLabel(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Do not show on the standalone chat page or if not authenticated
  if (!isAuthenticated || location.pathname === '/chat') return null;

  return (
    <>
      <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-[90] flex items-center gap-3">
        {/* Optional Label (Desktop Only) */}
        <div 
          className={`hidden sm:flex items-center px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-full shadow-lg border border-gray-100 dark:border-gray-700 transition-all duration-700 ease-out transform ${
            showLabel && !isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'
          }`}
        >
          AI Assistant
        </div>

        {/* Circular Floating Button */}
        <button
          onClick={() => setIsOpen(true)}
          className={`flex items-center justify-center w-[60px] h-[60px] sm:w-[64px] sm:h-[64px] bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.2)] hover:shadow-[0_12px_40px_rgba(168,85,247,0.5)] active:scale-95 transition-all duration-300 group focus:outline-none focus:ring-4 focus:ring-purple-500/50 ${!isOpen && 'hover:-translate-y-1'}`}
          aria-label="Open AI Assistant"
        >
          <Sparkles className="w-6 h-6 sm:w-7 sm:h-7 text-white drop-shadow-sm group-hover:scale-110 group-hover:rotate-12 transition-transform duration-300" />
        </button>
      </div>
      
      <ChatDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
