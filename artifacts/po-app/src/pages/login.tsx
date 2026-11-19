import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { FiEye, FiEyeOff } from "react-icons/fi";
import {
  BarChart3,
  ClipboardCheck,
  LineChart,
  Package,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { markBrowserSessionLive } from "@/lib/browser-session";
import {
  AuthMobileShell,
  RequiredMark,
  authMobileInputClass,
  authMobileLabelClass,
  authMobilePasswordInputClass,
} from "@/components/auth/AuthMobileShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import keyTypeUrl from "@/assets/sounds/key-type.wav";
import signInDoorUrl from "@/assets/sounds/sign-in-door.wav";
import loginOfficeBg from "@/assets/login-office-bg.jpg";
import bizoneLogo from "@assets/bizone_logo_optimized.webp";

const SIGN_IN_SUBTITLE =
  "Welcome back! Sign in to access your account with your registered username or email address.";

const FEATURES = [
  { label: "Sales & CRM", Icon: ClipboardCheck },
  { label: "Inventory Management", Icon: Package },
  { label: "Reports & Analytics", Icon: BarChart3 },
  { label: "HR & Accounts", Icon: Users },
] as const;

const BENEFITS = [
  { label: "Faster Productivity", Icon: Zap },
  { label: "Higher Security", Icon: ShieldCheck },
  { label: "Better Business Insights", Icon: LineChart },
] as const;

type DoorPhase = "closed" | "opening" | "walking" | "entering" | "closing" | "done";

function SignInDoor({ phase, snap = false }: { phase: DoorPhase; snap?: boolean }) {
  const open = phase === "opening" || phase === "walking" || phase === "entering";
  const stepping = phase === "walking" || phase === "entering";
  const inside = phase === "entering" || phase === "closing" || phase === "done";

  return (
    <span
      className={`bizone-door${open ? " is-open" : ""}${stepping ? " is-stepping" : ""}${phase === "walking" ? " is-walking" : ""}${inside ? " is-inside" : ""}${snap ? " is-snap" : ""}`}
      aria-hidden="true"
    >
      <svg className="bizone-stick" viewBox="0 0 20 44">
        <circle cx="10" cy="6.2" r="4.3" fill="#fff" />
        <path d="M10 11.2V23.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <g className="leg leg-back">
          <path d="M10 23.5 6.1 40" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <g className="leg leg-front">
          <path d="M10 23.5 13.9 40" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </svg>
      <span className="bizone-door-frame">
        <span className="bizone-door-glow" />
        <span className="bizone-door-panel">
          <span className="bizone-door-handle" />
        </span>
      </span>
    </span>
  );
}

function playKeyClick() {
  const audio = new Audio(keyTypeUrl);
  audio.volume = 0.85;
  void audio.play().catch(() => {});
}

function isTypingKey(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return false;
  if (event.key === "Backspace" || event.key === "Delete") return true;
  return event.key.length === 1;
}

function useAuthPageFont() {
  useEffect(() => {
    document.documentElement.classList.add("auth-page");
    return () => document.documentElement.classList.remove("auth-page");
  }, []);
}

export default function Login() {
  useAuthPageFont();

  const [, setLocation] = useLocation();
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [panel, setPanel] = useState<"login" | "forgot">("login");
  const [forgotHeading, setForgotHeading] = useState({
    title: "Forgot Password",
    subtitle: "Choose email or contact number to get a verification code",
  });
  const setForgotHeadingStable = useCallback((heading: { title: string; subtitle: string }) => {
    setForgotHeading(heading);
  }, []);
  const [door, setDoor] = useState<DoorPhase>("closed");
  const [doorSnap, setDoorSnap] = useState(false);
  const [entering, setEntering] = useState(false);
  const holdRedirect = useRef(false);
  const doorDone = useRef<Promise<void> | null>(null);
  const doorTimers = useRef<number[]>([]);
  const doorAudio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!isLoading && user && !holdRedirect.current) {
      setLocation("/");
    }
  }, [isLoading, user, setLocation]);

  function stopDoorSound() {
    const audio = doorAudio.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  function clearDoorTimers() {
    doorTimers.current.forEach((id) => window.clearTimeout(id));
    doorTimers.current = [];
  }

  function startDoor() {
    clearDoorTimers();
    stopDoorSound();
    setDoor("opening");

    const audio = doorAudio.current ?? new Audio(signInDoorUrl);
    doorAudio.current = audio;
    audio.volume = 1;
    audio.currentTime = 0;
    void audio.play().catch(() => {});

    const later = (ms: number, fn: () => void) => {
      doorTimers.current.push(window.setTimeout(fn, ms));
    };

    doorDone.current = new Promise((resolve) => {
      later(380, () => setDoor("walking"));
      later(1000, () => setDoor("entering"));
      later(1320, () => setDoor("closing"));
      later(1680, () => setDoor("done"));
      later(2350, resolve);
    });
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const nextErrors: { email?: string; password?: string } = {};
    if (!form.email.trim()) nextErrors.email = "Email is required";
    if (!form.password) nextErrors.password = "Password is required";

    if (nextErrors.email || nextErrors.password) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    if (door !== "closed" || loginMutation.isPending) return;
    startDoor();

    loginMutation.mutate(
      {
        data: {
          username: form.email.trim().toLowerCase(),
          password: form.password,
        },
      },
      {
        onSuccess: async (data) => {
          holdRedirect.current = true;
          setEntering(true);
          const sessionId = (data as { sessionId?: string }).sessionId;
          if (sessionId) markBrowserSessionLive(sessionId);
          queryClient.clear();

          const companyId =
            data.user.selectedCompanyId ??
            data.user.companyId ??
            (data.user.companies?.length === 1 ? data.user.companies[0]?.id : null);

          let userWithCompany = { ...data.user, selectedCompanyId: companyId ?? data.user.selectedCompanyId };

          if (companyId) {
            try {
              await fetch("/api/auth/select-company", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ companyId }),
              });
              userWithCompany = { ...userWithCompany, selectedCompanyId: companyId };
            } catch {
              // Session may already have the company from login response.
            }
          }

          queryClient.setQueryData(getGetMeQueryKey(), userWithCompany);

          if (rememberMe) {
            localStorage.setItem("bizone_remember", "1");
          } else {
            localStorage.removeItem("bizone_remember");
          }
          toast({ title: "Login Successful" });
          await doorDone.current;
          holdRedirect.current = false;
          setLocation("/");
        },
        onError: (error: Error & { message?: string }) => {
          clearDoorTimers();
          stopDoorSound();
          setDoorSnap(true);
          setDoor("closed");
          doorDone.current = null;
          window.setTimeout(() => setDoorSnap(false), 60);
          if (error.message === "Network Error") {
            toast({
              title: "Server connect avvadam ledu. Backend run avutunda check cheyandi.",
              variant: "destructive",
            });
            return;
          }
          setFieldErrors({});
          toast({ title: "Invalid email or password", variant: "destructive" });
        },
      },
    );
  };

  if ((isLoading || user) && !entering) {
    return null;
  }

  const loading = loginMutation.isPending || door !== "closed";
  const pageSubtitle = panel === "login" ? SIGN_IN_SUBTITLE : forgotHeading.subtitle;

  const fieldErrorClass = "mb-0 mt-1 text-[0.8rem] font-medium text-red-600";
  const desktopInputClass =
    "w-full h-11 rounded-[10px] border border-gray-200 bg-[#f8fafc] px-3 text-[0.9rem] text-[#101828] outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]";
  const desktopPasswordClass =
    "w-full h-11 rounded-[10px] border border-gray-200 bg-[#f8fafc] pl-3 pr-[42px] text-[0.9rem] text-[#101828] outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]";
  const inputErrorRing = "border-red-500 focus:border-red-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]";

  const loginFormFields = (variant: "mobile" | "desktop") => {
    const labelClass = variant === "mobile" ? authMobileLabelClass : "text-[0.9rem] font-semibold text-[#101828]";
    const emailClass =
      variant === "mobile"
        ? `${authMobileInputClass}${fieldErrors.email ? ` ${inputErrorRing}` : ""}`
        : `${desktopInputClass}${fieldErrors.email ? ` ${inputErrorRing}` : ""}`;
    const passwordClass =
      variant === "mobile"
        ? `${authMobilePasswordInputClass}${fieldErrors.password ? ` ${inputErrorRing}` : ""}`
        : `${desktopPasswordClass}${fieldErrors.password ? ` ${inputErrorRing}` : ""}`;

    return (
      <form
        className={`flex flex-col ${variant === "desktop" ? "gap-3.5" : "gap-5"}`}
        onSubmit={handleSubmit}
        data-allow-autofill="true"
        autoComplete="on"
      >
        <label className={`flex min-w-0 flex-col ${variant === "desktop" ? "gap-1.5" : "gap-2"}`}>
          <span className={labelClass}>
            Email Address
            <RequiredMark />
          </span>
          <input
            type="email"
            name="email"
            placeholder="Enter your email address"
            value={form.email}
            onChange={handleChange}
            onKeyDown={(event) => {
              if (isTypingKey(event)) playKeyClick();
            }}
            autoComplete="email"
            data-allow-autofill="true"
            aria-invalid={Boolean(fieldErrors.email)}
            className={emailClass}
            style={{ fontFamily: "Poppins, sans-serif" }}
          />
          {fieldErrors.email ? <p className={fieldErrorClass}>{fieldErrors.email}</p> : null}
        </label>

        <label className={`flex min-w-0 flex-col ${variant === "desktop" ? "gap-1.5" : "gap-2"}`}>
          <span className={labelClass}>
            Password
            <RequiredMark />
          </span>
          <div className="relative flex items-center">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              placeholder="Enter your password"
              value={form.password}
              onChange={handleChange}
              onKeyDown={(event) => {
                if (isTypingKey(event)) playKeyClick();
              }}
              autoComplete="current-password"
              data-allow-autofill="true"
              aria-invalid={Boolean(fieldErrors.password)}
              className={passwordClass}
              style={{ fontFamily: "Poppins, sans-serif" }}
            />
            <button
              type="button"
              className="absolute right-3 cursor-pointer border-0 bg-transparent p-1 text-[1.1rem] text-gray-400 hover:text-gray-600"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <FiEyeOff /> : <FiEye />}
            </button>
          </div>
          {fieldErrors.password ? <p className={fieldErrorClass}>{fieldErrors.password}</p> : null}
        </label>

        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[0.88rem] text-[#101828]">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-[15px] w-[15px] accent-blue-600"
            />
            <span>Remember me</span>
          </label>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-[0.88rem] font-semibold text-blue-600 hover:underline"
            onClick={() => setPanel("forgot")}
          >
            Forgot Password?
          </button>
        </div>

        <div>
          <button
            type="submit"
            disabled={loading || door !== "closed"}
            className="relative flex h-14 w-full cursor-pointer items-center rounded-[10px] border-0 bg-blue-600 pl-4 pr-2 text-[0.95rem] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-90"
            style={{ fontFamily: "Poppins, sans-serif" }}
          >
            <span className="flex-1 text-center">Sign in</span>
            <SignInDoor phase={door} snap={doorSnap} />
          </button>
          {door === "done" ? (
            <p className="mb-0 mt-2 text-center text-sm font-medium text-gray-500">Welcome back!</p>
          ) : door !== "closed" ? (
            <p className="mb-0 mt-2 text-center text-sm font-medium text-blue-600">Signing you in...</p>
          ) : null}
        </div>

        <p
          className={`mb-0 text-center text-[0.9rem] text-gray-600 ${
            variant === "desktop" ? "mt-5 shrink-0" : "mt-1"
          }`}
        >
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-semibold text-blue-600 no-underline hover:underline">
            Sign Up
          </Link>
        </p>
      </form>
    );
  };

  const formBodyMobile =
    panel === "login" ? (
      loginFormFields("mobile")
    ) : (
      <ForgotPasswordForm
        onHeading={setForgotHeadingStable}
        onBack={() => setPanel("login")}
        onReset={(email) => {
          if (email) setForm((prev) => ({ ...prev, email, password: "" }));
          else setForm((prev) => ({ ...prev, password: "" }));
          setPanel("login");
          toast({ title: "Password reset. Sign in with your new 8-digit password." });
        }}
      />
    );

  const formBodyDesktop =
    panel === "login" ? (
      loginFormFields("desktop")
    ) : (
      <ForgotPasswordForm
        onHeading={setForgotHeadingStable}
        onBack={() => setPanel("login")}
        onReset={(email) => {
          if (email) setForm((prev) => ({ ...prev, email, password: "" }));
          else setForm((prev) => ({ ...prev, password: "" }));
          setPanel("login");
          toast({ title: "Password reset. Sign in with your new 8-digit password." });
        }}
      />
    );

  return (
    <>
      <style>{`
        .bizone-door.is-snap .bizone-stick,
        .bizone-door.is-snap .bizone-door-panel,
        .bizone-door.is-snap .bizone-door-glow {
          transition: none;
        }
        .bizone-door {
          position: absolute;
          right: 12px;
          bottom: 8px;
          display: block;
          width: 58px;
          height: 40px;
          pointer-events: none;
        }
        .bizone-stick {
          position: absolute;
          left: 0;
          bottom: 0;
          z-index: 3;
          width: 16px;
          height: 36px;
          overflow: visible;
          transform: translateX(0);
          opacity: 1;
          transition: transform 0.62s linear, opacity 0.22s linear;
        }
        .bizone-door.is-walking .bizone-stick {
          transform: translateX(12px);
        }
        .bizone-door.is-inside .bizone-stick {
          transform: translateX(30px);
          opacity: 0;
        }
        .bizone-stick .leg {
          transform-box: fill-box;
          transform-origin: 50% 0%;
        }
        .bizone-door.is-stepping .leg-front {
          animation: bizone-thigh-front 0.46s linear infinite;
        }
        .bizone-door.is-stepping .leg-back {
          animation: bizone-thigh-back 0.46s linear infinite;
        }
        @keyframes bizone-thigh-front {
          0% { transform: rotate(26deg); }
          50% { transform: rotate(-34deg); }
          100% { transform: rotate(26deg); }
        }
        @keyframes bizone-thigh-back {
          0% { transform: rotate(-22deg); }
          50% { transform: rotate(30deg); }
          100% { transform: rotate(-22deg); }
        }
        .bizone-door-frame {
          position: absolute;
          right: 0;
          bottom: 0;
          display: block;
          width: 28px;
          height: 38px;
          overflow: hidden;
          border-radius: 8px;
          background: #0b1020;
          perspective: 140px;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.28);
        }
        .bizone-door-glow {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 42% 48%, rgba(255,214,130,0.98) 0%, rgba(190,120,40,0.55) 26%, rgba(20,16,12,0.2) 58%, #070b14 78%);
          opacity: 0;
          transition: opacity 0.32s ease;
        }
        .bizone-door.is-open .bizone-door-glow {
          opacity: 0.95;
        }
        .bizone-door-panel {
          position: absolute;
          inset: 0;
          border-radius: 7px;
          background: linear-gradient(165deg, rgba(255,255,255,0.97) 0%, rgba(219,234,254,0.9) 46%, rgba(147,197,253,0.94) 100%);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.75);
          transform-origin: right center;
          transition: transform 0.38s ease;
          backface-visibility: hidden;
        }
        .bizone-door.is-open .bizone-door-panel {
          transform: rotateY(72deg);
        }
        .bizone-door-handle {
          position: absolute;
          left: 7px;
          top: 50%;
          width: 3px;
          height: 11px;
          margin-top: -5.5px;
          border-radius: 2px;
          background: #fff;
        }

        @keyframes login-fade-in {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes login-from-left {
          from { opacity: 0; transform: translateX(-48px); }
          to { opacity: 1; transform: translateX(0); }
        }
        /* Start on the laptop screen (center), fly out to the left list */
        @keyframes login-from-laptop {
          0% {
            opacity: 0;
            transform: translate(210px, 70px) scale(0.2);
            filter: blur(5px);
          }
          35% {
            opacity: 1;
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translate(0, 0) scale(1);
            filter: blur(0);
          }
        }
        @keyframes login-benefits-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .login-anim-logo {
          opacity: 0;
          animation: login-fade-in 0.55s ease-out 0.05s forwards;
        }
        .login-anim-from-left {
          opacity: 0;
          animation: login-from-left 0.6s ease-out forwards;
        }
        .login-anim-headline { animation-delay: 0.28s; }
        .login-anim-sub { animation-delay: 0.48s; }
        .login-anim-from-laptop {
          opacity: 0;
          will-change: transform, opacity, filter;
          animation: login-from-laptop 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .login-anim-feature-0 { animation-delay: 0.85s; }
        .login-anim-feature-1 { animation-delay: 1.15s; }
        .login-anim-feature-2 { animation-delay: 1.45s; }
        .login-anim-feature-3 { animation-delay: 1.75s; }
        .login-anim-benefits {
          opacity: 0;
          animation: login-benefits-in 0.5s ease-out 2.15s forwards;
        }
      `}</style>
      <AuthMobileShell
        title={panel === "login" ? "Sign In" : forgotHeading.title}
        subtitle={pageSubtitle}
      >
        {formBodyMobile}
      </AuthMobileShell>

      {/* Desktop: 80% canvas × 1.25 scale = 125% look at browser 100% */}
      <div
        className="auth-page fixed inset-0 z-10 hidden overflow-hidden min-[901px]:block"
        style={{ fontFamily: "Poppins, sans-serif" }}
      >
        <div
          className="relative origin-top-left"
          style={{ width: "80vw", height: "80vh", transform: "scale(1.25)" }}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${loginOfficeBg})` }}
            aria-hidden
          />

          {/* Left content — entrance animations */}
          <div className="relative z-10 flex h-full w-full flex-col pb-8 pl-12 pr-[min(540px,42%)] pt-12 xl:pl-14 xl:pt-14">
            <aside className="flex min-h-0 flex-1 flex-col">
              <div className="max-w-[520px]">
                <img
                  src={bizoneLogo}
                  alt="BizOne"
                  className="login-anim-logo mb-8 block h-[4.75rem] w-auto object-contain object-left"
                />

                <h1 className="login-anim-from-left login-anim-headline m-0 text-[clamp(2.5rem,3.8vw,3.35rem)] font-extrabold leading-[1.12] tracking-tight">
                  <span className="block whitespace-nowrap text-[#0B1F44]">Smarter Business.</span>
                  <span className="block whitespace-nowrap text-[#2563EB]">Greater Growth.</span>
                </h1>
                <p className="login-anim-from-left login-anim-sub mt-4 max-w-[420px] text-[1.2rem] font-medium leading-[1.55] text-[#64748B]">
                  Powerful ERP Solution to Manage,
                  <br />
                  Automate and Grow Your Business.
                </p>

                {/* Same place as before — animate in from the laptop, then settle here */}
                <ul className="mt-8 max-w-[250px] space-y-0 overflow-visible">
                  {FEATURES.map(({ label, Icon }, index) => (
                    <li
                      key={label}
                      className={`login-anim-from-laptop login-anim-feature-${index} flex items-center gap-3.5 py-[11px] ${
                        index < FEATURES.length - 1 ? "border-b border-[#CBD5E1]/75" : ""
                      }`}
                    >
                      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-[#93C5FD] bg-white/95 text-[#2563EB] shadow-sm">
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                      </span>
                      <span className="text-[0.98rem] font-semibold text-[#0B1F44]">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="login-anim-benefits mt-auto flex flex-nowrap items-center gap-x-4 pb-1 pt-10 whitespace-nowrap">
                {BENEFITS.map(({ label, Icon }, index) => (
                  <div key={label} className="flex shrink-0 items-center gap-3">
                    {index > 0 ? (
                      <span className="mr-1 h-6 w-px shrink-0 bg-[#94A3B8]/65" aria-hidden />
                    ) : null}
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#93C5FD] bg-white/95 text-[#2563EB]">
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </span>
                      <span className="text-[0.82rem] font-semibold text-[#0B1F44]">
                        <span className="text-[#2563EB]">{label.split(" ")[0]}</span>{" "}
                        {label.split(" ").slice(1).join(" ")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>

          {/* Auth box — after laptop/cup; original 520×580 size (same for Sign Up) */}
          <section
            className="absolute top-1/2 z-20 -translate-y-1/2"
            style={{ left: "62%", right: "2%" }}
          >
            <div className="ml-auto flex w-[520px] max-w-full flex-col rounded-[22px] bg-white px-10 pb-8 pt-9 shadow-[0_24px_60px_rgba(2,12,40,0.28)]">
              <div className="mb-5 shrink-0 text-center">
                <h2 className="m-0 text-[1.85rem] font-bold tracking-tight text-[#101828]">
                  {panel === "login" ? "Sign In" : forgotHeading.title}
                </h2>
                <p className="mx-auto mt-2 max-w-[380px] text-[0.9rem] leading-relaxed text-gray-500">
                  {pageSubtitle}
                </p>
              </div>
              <div className="flex flex-col">{formBodyDesktop}</div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
