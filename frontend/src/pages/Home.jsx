import { Plane, MessageCircle, Map, Sparkles, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-slate-950 px-6 overflow-hidden selection:bg-purple-500/30 selection:text-purple-200">
      
      {/* Subtle Mystical Ambient Glow Layer */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gradient-to-tr from-purple-600/10 to-pink-600/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="max-w-4xl w-full text-center space-y-12 relative z-10">
        
        {/* Brand Header */}
        <div className="space-y-4 animate-fade-in">
          <div className="inline-flex items-center gap-2.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-medium text-purple-400 mb-2 shadow-sm tracking-wide">
            <Sparkles className="w-3.5 h-3.5" />
            Next-Gen Itinerary Engineering
          </div>
          
          <div className="flex items-center justify-center gap-4">
            <Plane className="w-10 h-10 text-purple-400 rotate-12 drop-shadow-[0_0_15px_rgba(168,85,247,0.4)]" />
            <h1 className="text-6xl md:text-7xl font-extrabold text-white tracking-tight bg-clip-text">
              TravelTea
            </h1>
          </div>
          
          <p className="text-lg md:text-xl text-slate-400 font-light max-w-xl mx-auto tracking-wide leading-relaxed">
            AI-powered travel planning mapped out in seconds.
          </p>
        </div>

        {/* Minimal Feature Cards Grid */}
        <div className="grid md:grid-cols-3 gap-8 mt-16 text-left">
          
          {/* Feature 1 */}
          <div className="group relative space-y-4 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-900/40">
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:border-purple-500/50 transition-colors shadow-inner">
              <MessageCircle className="w-5 h-5 text-slate-400 group-hover:text-purple-400 transition-colors" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-wide mb-1.5">Chat Planning</h3>
              <p className="text-slate-400 text-sm font-light leading-relaxed">
                Describe your dream stay. Our assistant scripts your perfect day-by-day itinerary instantly.
              </p>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="group relative space-y-4 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-900/40">
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:border-purple-500/50 transition-colors shadow-inner">
              <Map className="w-5 h-5 text-slate-400 group-hover:text-purple-400 transition-colors" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-wide mb-1.5">Visual Mapping</h3>
              <p className="text-slate-400 text-sm font-light leading-relaxed">
                Watch your coordinates fall gracefully onto fully custom, high-density interactive layouts.
              </p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="group relative space-y-4 p-4 rounded-2xl transition-all duration-300 hover:bg-slate-900/40">
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:border-purple-500/50 transition-colors shadow-inner">
              <Sparkles className="w-5 h-5 text-slate-400 group-hover:text-purple-400 transition-colors" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-wide mb-1.5">Curated Gems</h3>
              <p className="text-slate-400 text-sm font-light leading-relaxed">
                Skip the generic tourist traps. Unearth local secrets handpicked by specialized agents.
              </p>
            </div>
          </div>
          
        </div>

        {/* Minimal Action Area */}
        <div className="pt-8 space-y-4">
          <button 
            onClick={() => navigate('/chat')}
            className="group inline-flex items-center gap-2 px-7 py-3.5 bg-white text-slate-950 hover:bg-slate-100 font-semibold rounded-xl transition-all duration-300 text-base shadow-xl hover:scale-[1.02] active:scale-[0.98]"
          >
            Start Planning
            <ArrowRight className="w-4 h-4 text-slate-950 transition-transform duration-300 group-hover:translate-x-1" />
          </button>
          
          <div className="flex items-center justify-center gap-2 text-xs tracking-wider text-slate-500 uppercase font-semibold">
            <span>Phase 1</span>
            <span className="w-1 h-1 rounded-full bg-purple-500/60" />
            <span className="text-slate-400">Live Chat Engine Enabled</span>
          </div>
        </div>

      </div>
    </div>
  );
}