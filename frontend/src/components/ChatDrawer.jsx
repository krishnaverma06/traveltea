import React, { Suspense } from 'react';
import { Sparkles, X, Loader2 } from 'lucide-react';

const Chat = React.lazy(() => import('@/pages/Chat'));

export default function ChatDrawer({ isOpen, onClose }) {
  const [hasOpened, setHasOpened] = React.useState(false);

  React.useEffect(() => {
    if (isOpen && !hasOpened) {
      setHasOpened(true);
    }
  }, [isOpen, hasOpened]);

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/40 z-[100] backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[460px] bg-white dark:bg-gray-900 z-[101] shadow-2xl transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center shadow-md">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">AI Assistant</h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-500 dark:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-hidden relative">
          {hasOpened && (
            <Suspense fallback={
              <div className="h-full w-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                  <p className="text-gray-500 dark:text-gray-400 font-medium">Loading Assistant...</p>
                </div>
              </div>
            }>
              <Chat isDrawer={true} />
            </Suspense>
          )}
        </div>
      </div>
    </>
  );
}
