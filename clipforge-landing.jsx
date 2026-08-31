import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  Link2,
  Play,
  Sparkles,
  Flame,
  TrendingUp,
  Scissors,
  Check,
  ArrowRight,
  ArrowLeft,
  Film,
  Mic,
  Gamepad2,
  GraduationCap,
  Download,
  Clock,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";

/* ---------------------------------- config ---------------------------------- */

// Point this at your running FastAPI backend (see app.py / INTEGRATION_GUIDE.md).
// In production, swap this for your deployed API's real URL.
const API_BASE_URL = "http://localhost:8000";

/* ---------------------------------- data ---------------------------------- */
// Used as placeholder/demo content wherever real backend data isn't available
// yet (e.g. browsing straight to the dashboard without uploading anything).

const VIDEO_TYPES = [
  { icon: Mic, name: "Podcasts", note: "hooks pulled from the cold open" },
  { icon: GraduationCap, name: "Talks & Lectures", note: "key insight, isolated and captioned" },
  { icon: Gamepad2, name: "Gaming & Streams", note: "clutch moments, auto-timed to the kill" },
  { icon: Flame, name: "Interviews", note: "the quote that will get quoted back" },
];

const CAPTION_STYLES = [
  { id: "mrbeast", name: "MrBeast Style", sample: "THIS IS INSANE", cls: "text-[#FFD84D] font-extrabold" },
  { id: "hormozi", name: "Hormozi Style", sample: "You NEED to see this", cls: "text-white font-extrabold" },
  { id: "cinematic", name: "Cinematic Minimal", sample: "the moment everything changed", cls: "text-white/90 font-light lowercase tracking-wide" },
  { id: "podcast", name: "Podcast Clean", sample: "Let's talk about growth", cls: "text-[#E8E5F5] font-medium" },
];

const DEMO_CLIPS = [
  {
    id: 1, title: "The Secret to Viral Growth \ud83d\udd25", score: 94, start: "02:14", end: "02:48",
    reason: "Strong hook in the first 3 seconds, with the payoff delivered before attention drops.",
    breakdown: { hook: 96, pacing: 90, payoff: 95 }, captionStyle: "mrbeast", downloadUrl: null,
  },
  {
    id: 2, title: "Nobody Tells You This About Scaling", score: 88, start: "11:47", end: "12:08",
    reason: "High information density and a quotable line right at the 0:14 mark.",
    breakdown: { hook: 82, pacing: 91, payoff: 88 }, captionStyle: "hormozi", downloadUrl: null,
  },
  {
    id: 3, title: "I Almost Gave Up Here...", score: 81, start: "24:02", end: "24:49",
    reason: "Emotional turning point in the story with a strong retention curve through the end.",
    breakdown: { hook: 74, pacing: 80, payoff: 86 }, captionStyle: "cinematic", downloadUrl: null,
  },
];

const DEMO_VIDEO_META = {
  title: "How I Built a 7-Figure Business From Zero \u2014 Full Interview",
  durationLabel: "38:12",
  sizeLabel: "1080p source",
  uploadedLabel: "Uploaded 2 minutes ago",
  objectUrl: null,
  isReal: false,
};

const STAGE_LABELS = {
  queued: "Queued\u2026",
  transcribing: "Transcribing audio\u2026",
  selecting_clips: "Scanning transcript for hook-worthy moments\u2026",
  cutting_clips: "Cutting and reframing clips\u2026",
};

function stageLabel(stage) {
  if (!stage) return "Processing\u2026";
  if (stage.startsWith("cutting_clip_")) {
    const [, i, , n] = stage.split("_"); // cutting_clip_{i}_of_{n}
    return `Cutting clip ${i} of ${n}\u2026`;
  }
  return STAGE_LABELS[stage] || "Processing\u2026";
}

function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* --------------------------------- shared ---------------------------------- */

const FontStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
    .font-sans { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; }
    .font-display { font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif; }
    @keyframes fanIn {
      from { opacity: 0; transform: translateY(14px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes softPulse {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }
    @keyframes gridDrift {
      from { background-position: 0 0; }
      to { background-position: 64px 64px; }
    }
    @keyframes expandCard {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .clip-enter { animation: fanIn 520ms cubic-bezier(0.16,1,0.3,1) both; }
    .pulse-dot { animation: softPulse 1.4s ease-in-out infinite; }
    .detail-enter { animation: expandCard 360ms cubic-bezier(0.16,1,0.3,1) both; }
    .bg-grid {
      background-image:
        linear-gradient(to right, rgba(168,85,247,0.06) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(168,85,247,0.06) 1px, transparent 1px);
      background-size: 64px 64px;
      animation: gridDrift 40s linear infinite;
    }
  `}</style>
);

const Backdrop = () => (
  <div className="fixed inset-0 pointer-events-none overflow-hidden">
    <div className="absolute inset-0 bg-grid opacity-40" />
    <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full bg-[#6C5CE7] opacity-[0.16] blur-[140px]" />
    <div className="absolute top-1/3 -right-32 w-[500px] h-[500px] rounded-full bg-[#F472B6] opacity-[0.09] blur-[140px]" />
  </div>
);

function ScoreRing({ score, size = 44 }) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = score >= 90 ? "#F472B6" : score >= 80 ? "#A855F7" : "#818CF8";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="#2A2640" strokeWidth="3" />
        <circle
          cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-[#F3F1FA]">
        {score}
      </span>
    </div>
  );
}

/* -------------------------------- landing ---------------------------------- */

function LandingPage({ onOpenDashboard, onClipsReady }) {
  const [stage, setStage] = useState("idle"); // idle | dragging | uploading | processing | done | error
  const [jobStage, setJobStage] = useState(null);
  const [urlValue, setUrlValue] = useState("");
  const [urlNotice, setUrlNotice] = useState(false);
  const [revealedClips, setRevealedClips] = useState(0);
  const [previewClips, setPreviewClips] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [billing, setBilling] = useState("monthly");
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);
  const objectUrlRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const pollJob = useCallback((jobId, videoMeta) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/jobs/${jobId}`);
        if (!res.ok) throw new Error(`Status check failed (${res.status})`);
        const job = await res.json();
        setJobStage(job.stage);

        if (job.status === "done") {
          clearInterval(pollRef.current);
          const clips = job.clips.map((c, i) => ({
            id: i + 1,
            title: c.title,
            score: c.viral_score,
            start: formatSeconds(c.start),
            end: formatSeconds(c.end),
            reason: c.reason,
            breakdown: null, // backend doesn't return a hook/pacing/payoff breakdown yet
            captionStyle: "mrbeast", // caption style is a display-only choice; export doesn't burn it in yet
            downloadUrl: `${API_BASE_URL}${c.download_url}`,
            durationLabel: formatSeconds(c.end - c.start),
          }));
          setPreviewClips(clips);
          setStage("done");
          clips.forEach((_, i) => {
            setTimeout(() => setRevealedClips((n) => Math.max(n, i + 1)), i * 260);
          });
          onClipsReady(clips, videoMeta);
        } else if (job.status === "failed") {
          clearInterval(pollRef.current);
          setErrorMessage(job.error || "Processing failed.");
          setStage("error");
        }
      } catch (err) {
        clearInterval(pollRef.current);
        setErrorMessage(err.message || "Lost connection while checking job status.");
        setStage("error");
      }
    }, 2500);
  }, [onClipsReady]);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setErrorMessage("");
    setStage("uploading");
    setRevealedClips(0);

    // Build a local preview + read real duration straight from the file,
    // no server round-trip needed for this part.
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;

    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = objectUrl;
    probe.onloadedmetadata = async () => {
      const videoMeta = {
        title: file.name,
        durationLabel: formatSeconds(probe.duration || 0),
        sizeLabel: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        uploadedLabel: "Uploaded just now",
        objectUrl,
        isReal: true,
      };

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`${API_BASE_URL}/process-video`, { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Upload failed (${res.status})`);
        }
        const { job_id } = await res.json();
        setStage("processing");
        setJobStage("queued");
        pollJob(job_id, videoMeta);
      } catch (err) {
        setErrorMessage(
          err.message === "Failed to fetch"
            ? `Couldn't reach the backend at ${API_BASE_URL}. Is the FastAPI server running?`
            : err.message
        );
        setStage("error");
      }
    };
  }, [pollJob]);

  const handleDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    if (!urlValue.trim()) return;
    // Backend doesn't support fetching remote video URLs yet (no downloader
    // step wired in) -- surface that honestly instead of faking a result.
    setUrlNotice(true);
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    setStage("idle");
    setJobStage(null);
    setRevealedClips(0);
    setPreviewClips([]);
    setUrlValue("");
    setUrlNotice(false);
    setErrorMessage("");
  };

  return (
    <div className="relative">
      <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6C5CE7] to-[#F472B6] flex items-center justify-center">
            <Scissors size={16} strokeWidth={2.5} className="text-white" />
          </div>
          <span className="font-display font-semibold text-lg tracking-tight">Clipforge</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-[#B4AFCB]">
          <a href="#how" className="hover:text-[#F3F1FA] transition-colors">How it works</a>
          <a href="#types" className="hover:text-[#F3F1FA] transition-colors">Video types</a>
          <a href="#pricing" className="hover:text-[#F3F1FA] transition-colors">Pricing</a>
        </div>
        <button onClick={onOpenDashboard} className="text-sm font-medium px-4 py-2 rounded-lg bg-[#F3F1FA] text-[#0A0918] hover:bg-white transition-colors">
          Start free
        </button>
      </nav>

      <header className="max-w-6xl mx-auto px-6 pt-14 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#2A2640] bg-[#13111F]/80 text-xs text-[#B4AFCB] mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] pulse-dot" />
          Trained on 40,000+ viral shorts
        </div>
        <h1 className="font-display font-semibold text-[2.75rem] leading-[1.08] sm:text-6xl sm:leading-[1.05] tracking-tight max-w-3xl mx-auto">
          One long video. A dozen reasons for people to stop scrolling.
        </h1>
        <p className="mt-6 text-lg text-[#B4AFCB] max-w-xl mx-auto leading-relaxed">
          Drop in a podcast, talk, or stream. Clipforge finds the moments worth watching
          and cuts them for TikTok, Reels, and Shorts \u2014 captioned, reframed, and scored
          before you've finished your coffee.
        </p>

        <div className="mt-14 max-w-3xl mx-auto">
          {stage !== "done" ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setStage("dragging"); }}
              onDragLeave={() => setStage((s) => (s === "dragging" ? "idle" : s))}
              onDrop={handleDrop}
              onClick={() => stage === "idle" && fileInputRef.current?.click()}
              className={`relative rounded-2xl border-2 border-dashed p-10 sm:p-14 transition-all duration-300 ${
                stage === "idle" ? "cursor-pointer" : ""
              } ${
                stage === "dragging" ? "border-[#A855F7] bg-[#A855F7]/10 scale-[1.01]" :
                stage === "error" ? "border-[#F87171]/50 bg-[#F87171]/5" :
                "border-[#2A2640] bg-[#13111F]/60 hover:border-[#443D66] hover:bg-[#13111F]"
              }`}
            >
              <input
                ref={fileInputRef} type="file" accept="video/*" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              {(stage === "uploading" || stage === "processing") && (
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="w-10 h-10 rounded-full border-2 border-[#2A2640] border-t-[#A855F7] animate-spin" />
                  <p className="text-sm text-[#B4AFCB]">
                    {stage === "uploading" ? "Uploading video\u2026" : stageLabel(jobStage)}
                  </p>
                </div>
              )}

              {stage === "error" && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <AlertTriangle size={22} className="text-[#F87171]" />
                  <p className="text-sm text-[#F3F1FA] max-w-sm">{errorMessage}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); reset(); }}
                    className="mt-1 text-xs px-3 py-1.5 rounded-lg bg-[#1B1830] border border-[#2A2640] hover:border-[#443D66] transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}

              {(stage === "idle" || stage === "dragging") && (
                <>
                  <div className="flex justify-center mb-5">
                    <div className="w-14 h-14 rounded-xl bg-[#1B1830] border border-[#2A2640] flex items-center justify-center">
                      <Upload size={22} className="text-[#A855F7]" />
                    </div>
                  </div>
                  <p className="font-medium text-[#F3F1FA]">Drag a video here, or click to browse</p>
                  <p className="text-sm text-[#8B87A0] mt-1.5 mb-6">MP4, MOV, or a link \u2014 up to 4 hours long</p>
                  <form onClick={(e) => e.stopPropagation()} onSubmit={handleUrlSubmit} className="flex items-center gap-2 max-w-md mx-auto">
                    <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-[#0A0918] border border-[#2A2640] focus-within:border-[#443D66] transition-colors">
                      <Link2 size={15} className="text-[#645D82] shrink-0" />
                      <input
                        type="text" value={urlValue}
                        onChange={(e) => { setUrlValue(e.target.value); setUrlNotice(false); }}
                        placeholder="Paste a YouTube link instead"
                        className="w-full bg-transparent text-sm outline-none placeholder:text-[#645D82]"
                      />
                    </div>
                    <button type="submit" className="px-4 py-2.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CF0] text-sm font-medium transition-colors shrink-0">
                      Forge clips
                    </button>
                  </form>
                  {urlNotice && (
                    <p className="mt-3 text-xs text-[#F0B429]">
                      Link import isn't wired up on the backend yet \u2014 upload a file directly for now.
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="text-left">
              <div className="flex items-center justify-between mb-5 px-1">
                <div className="flex items-center gap-2 text-sm text-[#B4AFCB]">
                  <Check size={15} className="text-[#4ADE80]" />
                  {previewClips.length} clips generated
                </div>
                <div className="flex items-center gap-4">
                  <button onClick={onOpenDashboard} className="text-xs text-[#A855F7] hover:text-[#C084FC] transition-colors font-medium">
                    Open full dashboard \u2192
                  </button>
                  <button onClick={reset} className="text-xs text-[#8B87A0] hover:text-[#F3F1FA] transition-colors">
                    Try another video
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {previewClips.map((clip, i) => (
                  <div key={clip.id} className={`rounded-xl border border-[#2A2640] bg-[#13111F] overflow-hidden ${i < revealedClips ? "clip-enter" : "opacity-0"}`}>
                    <div className="relative aspect-[9/16] bg-gradient-to-b from-[#1B1830] to-[#0F0D1A] flex items-center justify-center">
                      <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/50 text-[10px] text-[#B4AFCB]">
                        <Sparkles size={10} />AI pick
                      </div>
                      <div className="absolute top-2 right-2"><ScoreRing score={clip.score} size={44} /></div>
                      <div className="w-9 h-9 rounded-full bg-white/10 backdrop-blur flex items-center justify-center">
                        <Play size={14} className="text-white ml-0.5" fill="white" />
                      </div>
                      <div className="absolute bottom-2 left-2 text-[10px] text-[#8B87A0]">from {clip.start}</div>
                      <div className="absolute bottom-2 right-2 text-[10px] text-[#8B87A0]">{clip.durationLabel}</div>
                    </div>
                    <div className="px-2.5 py-2"><p className="text-xs font-medium truncate">{clip.title}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      <section id="how" className="max-w-6xl mx-auto px-6 py-20 border-t border-[#1B1830]">
        <div className="grid sm:grid-cols-3 gap-10">
          {[
            { n: "1", title: "Send the source", body: "Upload a file or paste a link. Clipforge transcribes it and reads it the way an editor would." },
            { n: "2", title: "It finds what earns attention", body: "Hooks, punchlines, and turning points get scored on pacing, payoff, and how they open \u2014 not just keyword spotting." },
            { n: "3", title: "Clips come out ready to post", body: "Reframed to 9:16, captioned, trimmed tight. Download or send straight to your queue." },
          ].map((step) => (
            <div key={step.n} className="flex gap-4">
              <span className="font-display text-2xl font-semibold text-[#443D66] shrink-0">{step.n}</span>
              <div>
                <h3 className="font-medium mb-1.5">{step.title}</h3>
                <p className="text-sm text-[#8B87A0] leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="types" className="max-w-6xl mx-auto px-6 py-20 border-t border-[#1B1830]">
        <div className="max-w-lg mb-12">
          <h2 className="font-display text-3xl font-semibold tracking-tight mb-3">The cut changes with what you feed it</h2>
          <p className="text-[#8B87A0] leading-relaxed">
            A podcast and a gaming stream don't get discovered the same way. Clipforge adjusts pacing, caption style, and what counts as a "moment" for each.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {VIDEO_TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.name} className="rounded-xl border border-[#2A2640] bg-[#13111F] p-5 hover:border-[#443D66] transition-colors">
                <Icon size={20} className="text-[#A855F7] mb-4" />
                <h3 className="font-medium mb-1.5">{t.name}</h3>
                <p className="text-sm text-[#8B87A0] leading-relaxed">{t.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20 border-t border-[#1B1830]">
        <div className="flex flex-col items-center text-center mb-12">
          <h2 className="font-display text-3xl font-semibold tracking-tight mb-3">Pricing that scales with your channel</h2>
          <p className="text-[#8B87A0] mb-6">No contracts. Cancel from your dashboard anytime.</p>
          <div className="inline-flex p-1 rounded-lg bg-[#13111F] border border-[#2A2640]">
            {["monthly", "yearly"].map((b) => (
              <button key={b} onClick={() => setBilling(b)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${billing === b ? "bg-[#6C5CE7] text-white" : "text-[#8B87A0]"}`}>
                {b} {b === "yearly" && <span className="text-[#4ADE80]">\u221220%</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {[
            { name: "Starter", price: billing === "monthly" ? 19 : 15, desc: "For creators posting a few clips a week", features: ["30 clips / month", "Auto captions", "9:16, 1:1, 16:9 exports", "720p downloads"], cta: "Start free", highlight: false },
            { name: "Creator", price: billing === "monthly" ? 49 : 39, desc: "For channels clipping every upload", features: ["150 clips / month", "Viral scoring & ranking", "Custom caption styles", "1080p downloads", "Priority processing"], cta: "Start free", highlight: true },
            { name: "Studio", price: billing === "monthly" ? 129 : 103, desc: "For agencies clipping for multiple clients", features: ["Unlimited clips", "Team seats & client folders", "Brand templates per client", "4K downloads", "API access"], cta: "Talk to us", highlight: false },
          ].map((plan) => (
            <div key={plan.name} className={`rounded-2xl p-7 flex flex-col ${plan.highlight ? "bg-gradient-to-b from-[#1B1830] to-[#13111F] border border-[#443D66] relative" : "bg-[#13111F] border border-[#2A2640]"}`}>
              {plan.highlight && <span className="absolute -top-3 left-7 px-2.5 py-1 rounded-full bg-[#6C5CE7] text-[11px] font-medium">Most picked</span>}
              <h3 className="font-medium mb-1">{plan.name}</h3>
              <p className="text-sm text-[#8B87A0] mb-5">{plan.desc}</p>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="font-display text-4xl font-semibold">${plan.price}</span>
                <span className="text-sm text-[#8B87A0]">/mo</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-[#B4AFCB]">
                    <Check size={15} className="text-[#A855F7] mt-0.5 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <button className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${plan.highlight ? "bg-[#6C5CE7] hover:bg-[#7C6CF0]" : "bg-[#1B1830] hover:bg-[#221D3A] border border-[#2A2640]"}`}>
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-24 border-t border-[#1B1830] text-center">
        <Sparkles size={22} className="text-[#A855F7] mx-auto mb-5" />
        <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight max-w-md mx-auto mb-4">
          Your next viral clip is already in your camera roll
        </h2>
        <p className="text-[#8B87A0] mb-8">It just hasn't been cut out yet.</p>
        <button onClick={onOpenDashboard} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#F3F1FA] text-[#0A0918] font-medium hover:bg-white transition-colors">
          Start forging clips
          <ArrowRight size={16} />
        </button>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-8 border-t border-[#1B1830] flex items-center justify-between text-xs text-[#645D82]">
        <span>\u00a9 2026 Clipforge</span>
        <div className="flex items-center gap-1.5"><Film size={13} /><span>Built for people who publish daily</span></div>
      </footer>
    </div>
  );
}

/* -------------------------------- dashboard ---------------------------------- */

function CaptionSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const active = CAPTION_STYLES.find((s) => s.id === value) ?? CAPTION_STYLES[0];

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0A0918] border border-[#2A2640] hover:border-[#443D66] transition-colors text-left"
      >
        <span className={`text-xs truncate ${active.cls}`}>{active.sample}</span>
        <ChevronDown size={13} className={`text-[#645D82] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-10 top-full mt-1.5 left-0 right-0 rounded-lg border border-[#2A2640] bg-[#151225] shadow-xl shadow-black/40 overflow-hidden detail-enter">
          {CAPTION_STYLES.map((s) => (
            <button
              key={s.id}
              onClick={(e) => { e.stopPropagation(); onChange(s.id); setOpen(false); }}
              className={`w-full flex flex-col items-start gap-0.5 px-3 py-2.5 hover:bg-[#1B1830] transition-colors ${s.id === value ? "bg-[#1B1830]" : ""}`}
            >
              <span className="text-[10px] text-[#8B87A0]">{s.name}</span>
              <span className={`text-xs ${s.cls}`}>{s.sample}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardClipCard({ clip, isActive, onSelect, captionStyle, onCaptionChange }) {
  const [exportState, setExportState] = useState("idle"); // idle | exporting | done
  const style = CAPTION_STYLES.find((s) => s.id === captionStyle) ?? CAPTION_STYLES[0];
  const isReal = Boolean(clip.downloadUrl);

  const handleFakeExport = (e) => {
    e.stopPropagation();
    setExportState("exporting");
    setTimeout(() => setExportState("done"), 1400);
    setTimeout(() => setExportState("idle"), 3400);
  };

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border bg-[#13111F] overflow-hidden cursor-pointer transition-all duration-300 ${
        isActive ? "border-[#6C5CE7] shadow-lg shadow-[#6C5CE7]/10" : "border-[#2A2640] hover:border-[#443D66]"
      }`}
    >
      <div className="flex gap-4 p-4">
        <div className="relative w-[92px] shrink-0 aspect-[9/16] rounded-lg bg-gradient-to-b from-[#1B1830] to-[#0F0D1A] overflow-hidden flex items-center justify-center">
          {isReal && isActive ? (
            <video src={clip.downloadUrl} className="absolute inset-0 w-full h-full object-cover" controls playsInline />
          ) : (
            <>
              <div className="w-8 h-8 rounded-full bg-white/10 backdrop-blur flex items-center justify-center">
                <Play size={12} className="text-white ml-0.5" fill="white" />
              </div>
              <span className={`absolute bottom-1.5 left-0 right-0 text-center text-[8px] px-1 ${style.cls}`}>
                {style.sample.length > 14 ? style.sample.slice(0, 14) + "\u2026" : style.sample}
              </span>
            </>
          )}
          <div className="absolute top-1.5 left-1.5 z-10">
            <ScoreRing score={clip.score} size={30} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm leading-snug mb-1.5 pr-2">{clip.title}</h3>
          <div className="flex items-center gap-1.5 text-[11px] text-[#8B87A0] mb-2">
            <Clock size={11} />
            <span>{clip.start} \u2013 {clip.end}</span>
          </div>
          {!isActive && (
            <p className="text-[11px] text-[#645D82] leading-relaxed line-clamp-2">{clip.reason}</p>
          )}
        </div>
      </div>

      {isActive && (
        <div className="px-4 pb-4 detail-enter">
          <p className="text-xs text-[#B4AFCB] leading-relaxed mb-4">{clip.reason}</p>

          {clip.breakdown && (
            <div className="space-y-2 mb-4">
              {Object.entries(clip.breakdown).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="text-[10px] text-[#8B87A0] w-14 capitalize shrink-0">{k}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[#1B1830] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#6C5CE7] to-[#A855F7]"
                      style={{ width: `${v}%`, transition: "width 700ms cubic-bezier(0.16,1,0.3,1)" }}
                    />
                  </div>
                  <span className="text-[10px] text-[#645D82] w-7 text-right shrink-0">{v}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-[10px] text-[#8B87A0]">Caption style</label>
            {isReal && <span className="text-[9px] text-[#645D82]">preview only \u2014 not burned into export yet</span>}
          </div>
          <div className="mb-4" onClick={(e) => e.stopPropagation()}>
            <CaptionSelector value={captionStyle} onChange={onCaptionChange} />
          </div>

          {isReal ? (
            <a
              href={clip.downloadUrl}
              download
              onClick={(e) => e.stopPropagation()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CF0] text-sm font-medium transition-colors"
            >
              <Download size={14} />Download clip
            </a>
          ) : (
            <button
              onClick={handleFakeExport}
              disabled={exportState !== "idle"}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CF0] text-sm font-medium transition-colors disabled:opacity-80"
            >
              {exportState === "idle" && <><Download size={14} />Export clip</>}
              {exportState === "exporting" && <><RefreshCw size={14} className="animate-spin" />Exporting 1080p\u2026</>}
              {exportState === "done" && <><Check size={14} />Downloaded</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Dashboard({ onBack, clips: incomingClips, videoMeta: incomingVideoMeta }) {
  const usingRealData = Boolean(incomingClips && incomingClips.length > 0);
  const [clips, setClips] = useState(incomingClips && incomingClips.length > 0 ? incomingClips : DEMO_CLIPS);
  const [activeId, setActiveId] = useState(clips[0]?.id ?? 1);
  const videoMeta = incomingVideoMeta || DEMO_VIDEO_META;

  const updateCaption = (id, styleId) => {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, captionStyle: styleId } : c)));
  };

  return (
    <div className="relative">
      <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-6">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-[#8B87A0] hover:text-[#F3F1FA] transition-colors">
          <ArrowLeft size={15} />
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#6C5CE7] to-[#F472B6] flex items-center justify-center">
            <Scissors size={14} strokeWidth={2.5} className="text-white" />
          </div>
          <span className="font-display font-semibold text-base tracking-tight text-[#F3F1FA]">Clipforge</span>
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#443D66] to-[#2A2640] border border-[#2A2640]" />
      </nav>

      <main className="max-w-6xl mx-auto px-6 pb-24">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight mb-1">
            {usingRealData ? "Your clips are ready" : "Sample dashboard"}
          </h1>
          <p className="text-sm text-[#8B87A0]">
            {usingRealData
              ? `${clips.length} clips generated from your upload \u00b7 click one to see why it scored the way it did`
              : "This is placeholder data \u2014 upload a video from the homepage to see your real clips here."}
          </p>
        </div>

        <div className="grid lg:grid-cols-[360px_1fr] gap-6 items-start">
          <div className="rounded-2xl border border-[#2A2640] bg-[#13111F] overflow-hidden lg:sticky lg:top-6">
            <div className="relative aspect-video bg-gradient-to-br from-[#1B1830] to-[#0F0D1A] flex items-center justify-center">
              {videoMeta.isReal ? (
                <video src={videoMeta.objectUrl} className="absolute inset-0 w-full h-full object-cover" controls playsInline />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur flex items-center justify-center">
                  <Play size={18} className="text-white ml-0.5" fill="white" />
                </div>
              )}
              <span className="absolute bottom-2.5 right-2.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-[#E8E5F5] z-10">
                {videoMeta.durationLabel}
              </span>
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/50 text-[10px] text-[#4ADE80] z-10">
                <Check size={10} />Processed
              </div>
            </div>
            <div className="p-4">
              <h2 className="font-medium text-sm leading-snug mb-2">{videoMeta.title}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#8B87A0]">
                <span className="flex items-center gap-1"><Clock size={11} />{videoMeta.durationLabel}</span>
                <span>\u00b7</span>
                <span>{videoMeta.uploadedLabel}</span>
                <span>\u00b7</span>
                <span>{videoMeta.sizeLabel}</span>
              </div>
              <div className="mt-4 pt-4 border-t border-[#1B1830] flex items-center justify-between text-xs">
                <span className="text-[#8B87A0]">{clips.length} clips generated</span>
                <button className="flex items-center gap-1.5 text-[#A855F7] hover:text-[#C084FC] transition-colors font-medium">
                  <RefreshCw size={12} />Find more moments
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {clips.map((clip) => (
              <DashboardClipCard
                key={clip.id}
                clip={clip}
                isActive={activeId === clip.id}
                onSelect={() => setActiveId((cur) => (cur === clip.id ? cur : clip.id))}
                captionStyle={clip.captionStyle}
                onCaptionChange={(styleId) => updateCaption(clip.id, styleId)}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ----------------------------------- app ------------------------------------ */

export default function App() {
  const [view, setView] = useState("landing");
  const [realClips, setRealClips] = useState(null);
  const [realVideoMeta, setRealVideoMeta] = useState(null);

  const handleClipsReady = useCallback((clips, videoMeta) => {
    setRealClips(clips);
    setRealVideoMeta(videoMeta);
  }, []);

  return (
    <div className="min-h-screen w-full bg-[#0A0918] text-[#F3F1FA] font-sans antialiased selection:bg-[#A855F7] selection:text-white">
      <FontStyles />
      <Backdrop />
      {view === "landing" ? (
        <LandingPage onOpenDashboard={() => setView("dashboard")} onClipsReady={handleClipsReady} />
      ) : (
        <Dashboard onBack={() => setView("landing")} clips={realClips} videoMeta={realVideoMeta} />
      )}
    </div>
  );
}
