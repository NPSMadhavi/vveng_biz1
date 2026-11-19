import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  FiEye,
  FiEyeOff,
} from "react-icons/fi";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { SyncBridgeDatePicker } from "@/components/ui/sync-bridge-date-picker";
import { useToast } from "@/hooks/use-toast";
import { getAccountPasswordError } from "@/lib/account-password";
import { clearBrowserSessionLive, setTabSessionId } from "@/lib/browser-session";
import {
  formatSingaporePhoneForApi,
  parseSingaporePhoneDigits,
  SG_PHONE_DIGITS,
  SG_PHONE_PREFIX,
  validateSingaporePhoneDigits,
} from "@/lib/singapore-phone";
import {
  AuthMobileShell,
  AuthProgressDots,
  RequiredMark,
  authMobileLabelClass,
} from "@/components/auth/AuthMobileShell";
import logo from "@assets/bizone_logo_optimized.webp";
import loginOfficeBg from "@/assets/login-office-bg.jpg";
import {
  BarChart3,
  ClipboardCheck,
  LineChart,
  Package,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";

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

const desktopInputClassName =
  "w-full h-10 border border-gray-200 rounded-[10px] bg-white px-3 text-[0.85rem] text-[#101828] outline-none focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] placeholder:text-gray-400";

const desktopPasswordInputClassName =
  "w-full h-10 border border-gray-200 rounded-[10px] bg-white pl-3 pr-[42px] text-[0.85rem] text-[#101828] outline-none focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] placeholder:text-gray-400";

const registerMobileInputClass =
  "w-full h-11 border border-gray-200 rounded-[10px] bg-[#f8fafc] px-3 text-[0.9rem] text-[#101828] outline-none focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] placeholder:text-gray-400";

const registerMobilePasswordInputClass =
  "w-full h-11 border border-gray-200 rounded-[10px] bg-[#f8fafc] pl-3 pr-[42px] text-[0.9rem] text-[#101828] outline-none focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] placeholder:text-gray-400";

const registerMobileTextareaClass =
  "w-full min-h-[88px] resize-none rounded-[10px] border border-gray-200 bg-[#f8fafc] px-3 py-2.5 text-[0.9rem] text-[#101828] outline-none placeholder:text-gray-400 focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]";

const registerDesktopTextareaClass =
  "w-full min-h-[72px] resize-none rounded-[10px] border border-gray-200 bg-white px-3 py-2.5 text-[0.85rem] text-[#101828] outline-none placeholder:text-gray-400 focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]";

function setFinancialYear(field: "fy_from" | "fy_to", value: string, current: CompanyForm): Pick<CompanyForm, "fy_from" | "fy_to"> {
  if (field === "fy_from") {
    return { fy_from: value, fy_to: current.fy_to };
  }
  return { fy_from: current.fy_from, fy_to: value };
}

function useAuthPageFont() {
  useEffect(() => {
    document.documentElement.classList.add("auth-page");
    return () => document.documentElement.classList.remove("auth-page");
  }, []);
}

type RegisterStep = 1 | 2;

interface PersonalForm {
  email: string;
  phone_number: string;
  password: string;
  confirm_password: string;
}

interface CompanyForm {
  company_name: string;
  gst_registration_no: string;
  slug: string;
  company_address: string;
  business_type: string;
  fy_from: string;
  fy_to: string;
}

function validateAccountStep(personal: PersonalForm, company: CompanyForm): string | null {
  if (!company.company_name.trim() || company.company_name.trim().length < 2) return "Company name is required";
  const phoneError = validateSingaporePhoneDigits(personal.phone_number.trim());
  if (phoneError) return phoneError;
  if (!personal.email.trim()) return "Email address is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personal.email.trim())) return "Enter a valid email address";
  if (!company.company_address.trim()) return "Address is required";
  if (company.company_address.trim().length < 5) return "Address is too short";
  return null;
}

function validateSecurityStep(personal: PersonalForm, company: CompanyForm): string | null {
  if (!company.slug.trim()) return "Slug is required";
  if (company.slug.trim().length < 3) return "Slug must be at least 3 letters or numbers";
  if (!company.fy_from || !company.fy_to) return "Select the financial year";
  if (company.fy_to < company.fy_from) return "Financial year end date must be on or after the start date";
  return null;
}

const CONFIRM_PASSWORD_MISMATCH = "does not match password";

/** Live + submit validation for password / confirm fields. */
function passwordFieldError(password: string, forSubmit = false): string | undefined {
  if (!password) return forSubmit ? "Password is required" : undefined;
  return getAccountPasswordError(password);
}

function confirmPasswordFieldError(password: string, confirm: string, forSubmit = false): string | undefined {
  if (!confirm) return forSubmit ? "Confirm password is required" : undefined;
  if (confirm !== password) return CONFIRM_PASSWORD_MISMATCH;
  return undefined;
}

function validatePasswordFields(personal: PersonalForm): { password?: string; confirm_password?: string } {
  return {
    password: passwordFieldError(personal.password, true),
    confirm_password: confirmPasswordFieldError(personal.password, personal.confirm_password, true),
  };
}

export default function Register() {
  useAuthPageFont();

  const [, setLocation] = useLocation();
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<RegisterStep>(1);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<{ password?: string; confirm_password?: string }>({});
  const [personalForm, setPersonalForm] = useState<PersonalForm>({
    email: "",
    phone_number: "",
    password: "",
    confirm_password: "",
  });
  const [companyForm, setCompanyForm] = useState<CompanyForm>({
    company_name: "",
    gst_registration_no: "",
    slug: "",
    company_address: "",
    business_type: "",
    fy_from: "",
    fy_to: "",
  });

  useEffect(() => {
    if (!isLoading && user) {
      setLocation("/dashboard");
    }
  }, [isLoading, user, setLocation]);

  // Live password / confirm validation while typing (step 2 — Company Details)
  useEffect(() => {
    if (step !== 2) return;
    setPasswordErrors({
      password: passwordFieldError(personalForm.password),
      confirm_password: confirmPasswordFieldError(personalForm.password, personalForm.confirm_password),
    });
  }, [step, personalForm.password, personalForm.confirm_password]);

  /** Bind by field key — never e.target.name (autofill blocker may rewrite DOM name). */
  const setPersonalField = (field: keyof PersonalForm, value: string) => {
    if (field === "phone_number") {
      setPersonalForm((prev) => ({ ...prev, phone_number: parseSingaporePhoneDigits(value) }));
      return;
    }
    setPersonalForm((prev) => ({ ...prev, [field]: value }));
  };

  const setCompanyField = (field: keyof CompanyForm, value: string) => {
    if (field === "slug") {
      setCompanyForm((prev) => ({ ...prev, slug: value.toLowerCase().replace(/[^a-z0-9]/g, "") }));
      return;
    }
    if (field === "fy_from" || field === "fy_to") {
      setCompanyForm((prev) => ({ ...prev, ...setFinancialYear(field, value, prev) }));
      return;
    }
    setCompanyForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateAccountStep(personalForm, companyForm);
    if (error) {
      toast({ title: error, variant: "destructive" });
      return;
    }
    setStep(2);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    const accountError = validateAccountStep(personalForm, companyForm);
    if (accountError) {
      toast({ title: accountError, variant: "destructive" });
      setStep(1);
      return;
    }

    const securityError = validateSecurityStep(personalForm, companyForm);
    if (securityError) {
      toast({ title: securityError, variant: "destructive" });
      return;
    }

    const pwErrors = validatePasswordFields(personalForm);
    if (pwErrors.password || pwErrors.confirm_password) {
      setPasswordErrors(pwErrors);
      return;
    }
    setPasswordErrors({});

    try {
      setLoading(true);
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fullName: companyForm.company_name.trim(),
          email: personalForm.email.trim().toLowerCase(),
          phoneNumber: formatSingaporePhoneForApi(personalForm.phone_number.trim()),
          password: personalForm.password,
          companyName: companyForm.company_name.trim(),
          companyEmail: personalForm.email.trim().toLowerCase(),
          companyAddress: companyForm.company_address.trim(),
          businessType: companyForm.business_type.trim() || "trading",
          gstRegistrationNo: companyForm.gst_registration_no.trim() || undefined,
          financialYearFrom: companyForm.fy_from,
          financialYearTo: companyForm.fy_to,
          slug: companyForm.slug.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: data.error ?? "Registration failed",
          variant: "destructive",
        });
        return;
      }

      if (typeof data.sessionId === "string" && data.sessionId) {
        setTabSessionId(data.sessionId);
      }
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });

      clearBrowserSessionLive();
      queryClient.clear();

      toast({ title: data.message ?? "Registration Successful" });
      setLocation("/login");
    } catch (error) {
      const message =
        error instanceof Error && error.message === "Network Error"
          ? "Server connect avvadam ledu. Backend run avutunda check cheyandi."
          : "Registration failed";
      toast({ title: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (isLoading || user) {
    return null;
  }

  const mobileTitle = step === 1 ? "Sign up" : "Company Details";
  const mobileSubtitle =
    step === 1
      ? "Create your BizOne account to start managing enterprise assets"
      : "Tell us about your company to complete registration";
  const progressActive = step === 1 ? 2 : 0;
  const desktopTitle = step === 1 ? "Sign Up" : "Company Details";

  const signUpLink = (
    <p className="mb-0 mt-4 text-center text-[0.9rem] text-gray-600">
      Already Have an account?{" "}
      <Link href="/login" className="font-semibold text-blue-600 no-underline hover:underline">
        Sign in
      </Link>
    </p>
  );

  const personalFormMobile = (
    <form className="flex flex-col gap-4" onSubmit={handleNext} data-allow-autofill="true" autoComplete="on">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-2">
          <span className={`${authMobileLabelClass} text-[0.82rem]`}>Company Name<RequiredMark /></span>
          <input
            type="text"
            name="company_name"
            placeholder="Enter company name"
            value={companyForm.company_name}
            onChange={(e) => setCompanyField("company_name", e.target.value)}
            className={`${registerMobileInputClass} h-10 text-[0.85rem]`}
            style={{ fontFamily: "Poppins, sans-serif" }}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-2">
          <span className={`${authMobileLabelClass} text-[0.82rem]`}>Contact Number<RequiredMark /></span>
          <div className="flex">
            <span
              className="flex h-10 shrink-0 items-center rounded-l-[10px] border border-r-0 border-gray-200 bg-gray-50 px-2 text-[0.8rem] font-medium text-[#101828]"
              style={{ fontFamily: "Poppins, sans-serif" }}
            >
              {SG_PHONE_PREFIX}
            </span>
            <input
              type="tel"
              name="phone_number"
              placeholder="9123 4567"
              value={personalForm.phone_number}
              onChange={(e) => setPersonalField("phone_number", e.target.value)}
              autoComplete="tel-national" data-allow-autofill="true"
              inputMode="numeric"
              maxLength={SG_PHONE_DIGITS}
              className={`${registerMobileInputClass} h-10 rounded-l-none text-[0.85rem]`}
              style={{ fontFamily: "Poppins, sans-serif" }}
            />
          </div>
        </label>
      </div>

      <label className="flex min-w-0 flex-col gap-2">
        <span className={authMobileLabelClass}>Email Address<RequiredMark /></span>
        <input
          type="email"
          name="email"
          placeholder="Enter your email address"
          value={personalForm.email}
          onChange={(e) => setPersonalField("email", e.target.value)}
          autoComplete="email" data-allow-autofill="true"
          className={registerMobileInputClass}
          style={{ fontFamily: "Poppins, sans-serif" }}
        />
      </label>

      <label className="flex min-w-0 flex-col gap-2">
        <span className={authMobileLabelClass}>Address<RequiredMark /></span>
        <textarea
          name="company_address"
          placeholder="Enter company address"
          value={companyForm.company_address}
          onChange={(e) => setCompanyField("company_address", e.target.value)}
          rows={3}
          className={registerMobileTextareaClass}
          style={{ fontFamily: "Poppins, sans-serif" }}
        />
      </label>

      <div className="mt-2 flex gap-3">
        <Link
          href="/login"
          className="flex h-11 flex-1 items-center justify-center rounded-[10px] border border-gray-200 bg-white text-[0.95rem] text-[#101828] no-underline hover:bg-gray-50"
          style={{ fontFamily: "Poppins, sans-serif" }}
        >
          Back
        </Link>
        <button
          type="submit"
          className="h-11 flex-[1.4] cursor-pointer rounded-[10px] border-0 bg-blue-600 text-[0.95rem] font-semibold text-white hover:bg-blue-700"
          style={{ fontFamily: "Poppins, sans-serif" }}
        >
          Next
        </button>
      </div>
      {signUpLink}
    </form>
  );

  const companyFormMobile = (
    <form className="flex flex-col gap-4" onSubmit={handleSignUp} data-allow-autofill="true" autoComplete="on">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-2">
          <span className={`${authMobileLabelClass} text-[0.82rem]`}>Slug<RequiredMark /></span>
          <input
            type="text"
            name="slug"
            value={companyForm.slug}
            onChange={(e) => setCompanyField("slug", e.target.value)}
            className={`${registerMobileInputClass} h-10 text-[0.85rem]`}
            style={{ fontFamily: "Poppins, sans-serif" }}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-2">
          <span className={`${authMobileLabelClass} text-[0.82rem]`}>GST Registration</span>
          <input
            type="text"
            name="gst_registration_no"
            value={companyForm.gst_registration_no}
            onChange={(e) => setCompanyField("gst_registration_no", e.target.value)}
            className={`${registerMobileInputClass} h-10 text-[0.85rem]`}
            style={{ fontFamily: "Poppins, sans-serif" }}
          />
        </label>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <span className={authMobileLabelClass}>Financial Year<RequiredMark /></span>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-2">
            <span className={`${authMobileLabelClass} text-[0.82rem]`}>From<RequiredMark /></span>
            <SyncBridgeDatePicker
              value={companyForm.fy_from}
              onChange={(value) => setCompanyField("fy_from", value)}
              placeholder="DD/MM/YYYY"
              className="rounded-[10px] border-gray-200 bg-[#f8fafc] text-[0.85rem]"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-2">
            <span className={`${authMobileLabelClass} text-[0.82rem]`}>To<RequiredMark /></span>
            <SyncBridgeDatePicker
              value={companyForm.fy_to}
              onChange={(value) => setCompanyField("fy_to", value)}
              placeholder="DD/MM/YYYY"
              min={companyForm.fy_from || undefined}
              className="rounded-[10px] border-gray-200 bg-[#f8fafc] text-[0.85rem]"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-2">
          <span className={`${authMobileLabelClass} text-[0.82rem]`}>Password<RequiredMark /></span>
          <div className="relative flex items-center">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              value={personalForm.password}
              onChange={(e) => setPersonalField("password", e.target.value)}
              autoComplete="new-password" data-allow-autofill="true"
              aria-invalid={Boolean(passwordErrors.password)}
              className={`${registerMobilePasswordInputClass} h-10 text-[0.85rem]${passwordErrors.password ? " border-red-500" : ""}`}
              style={{ fontFamily: "Poppins, sans-serif" }}
            />
            <button
              type="button"
              className="absolute right-3 cursor-pointer border-0 bg-transparent p-1 text-[1.1rem] text-gray-400 hover:text-gray-500"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <FiEyeOff /> : <FiEye />}
            </button>
          </div>
          {passwordErrors.password ? (
            <p className="mb-0 text-[0.72rem] font-medium leading-snug text-red-600">{passwordErrors.password}</p>
          ) : null}
        </label>
        <label className="flex min-w-0 flex-col gap-2">
          <span className={`${authMobileLabelClass} text-[0.82rem]`}>Confirmation Password<RequiredMark /></span>
          <div className="relative flex items-center">
            <input
              type={showConfirm ? "text" : "password"}
              name="confirm_password"
              value={personalForm.confirm_password}
              onChange={(e) => setPersonalField("confirm_password", e.target.value)}
              autoComplete="new-password" data-allow-autofill="true"
              aria-invalid={Boolean(passwordErrors.confirm_password)}
              className={`${registerMobilePasswordInputClass} h-10 text-[0.85rem]${passwordErrors.confirm_password ? " border-red-500" : ""}`}
              style={{ fontFamily: "Poppins, sans-serif" }}
            />
            <button
              type="button"
              className="absolute right-3 cursor-pointer border-0 bg-transparent p-1 text-[1.1rem] text-gray-400 hover:text-gray-500"
              onClick={() => setShowConfirm((prev) => !prev)}
              aria-label={showConfirm ? "Hide password" : "Show password"}
            >
              {showConfirm ? <FiEyeOff /> : <FiEye />}
            </button>
          </div>
          {passwordErrors.confirm_password ? (
            <p className="mb-0 text-[0.72rem] font-medium leading-snug text-red-600">{passwordErrors.confirm_password}</p>
          ) : null}
        </label>
      </div>

      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => setStep(1)}
          disabled={loading}
          className="h-11 flex-1 cursor-pointer rounded-[10px] border border-gray-200 bg-white text-[0.95rem] text-[#101828] hover:bg-gray-50 disabled:opacity-70"
          style={{ fontFamily: "Poppins, sans-serif" }}
        >
          Back
        </button>
        <button
          type="submit"
          disabled={loading}
          className="h-11 flex-[1.4] cursor-pointer rounded-[10px] border-0 bg-blue-600 text-[0.95rem] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          style={{ fontFamily: "Poppins, sans-serif" }}
        >
          {loading ? "Creating account..." : "Sign up"}
        </button>
      </div>
      {signUpLink}
    </form>
  );

  const personalFormDesktop = (
    <form className="flex min-h-0 flex-1 flex-col gap-3.5" onSubmit={handleNext} data-allow-autofill="true" autoComplete="on">
      <div className="grid grid-cols-2 gap-3.5">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.82rem] font-semibold text-[#101828]">Company Name<RequiredMark /></span>
          <input
            type="text"
            name="company_name"
            placeholder="Enter company name"
            value={companyForm.company_name}
            onChange={(e) => setCompanyField("company_name", e.target.value)}
            className={desktopInputClassName}
            style={{ fontFamily: "Poppins, sans-serif" }}
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.82rem] font-semibold text-[#101828]">Contact Number<RequiredMark /></span>
          <div className="flex">
            <span
              className="flex h-10 shrink-0 items-center rounded-l-[10px] border border-r-0 border-gray-200 bg-gray-50 px-3 text-[0.85rem] font-medium text-[#101828]"
              style={{ fontFamily: "Poppins, sans-serif" }}
            >
              {SG_PHONE_PREFIX}
            </span>
            <input
              type="tel"
              name="phone_number"
              placeholder="9123 4567"
              value={personalForm.phone_number}
              onChange={(e) => setPersonalField("phone_number", e.target.value)}
              autoComplete="tel-national" data-allow-autofill="true"
              inputMode="numeric"
              maxLength={SG_PHONE_DIGITS}
              className={`${desktopInputClassName} rounded-l-none`}
              style={{ fontFamily: "Poppins, sans-serif" }}
            />
          </div>
        </label>
      </div>

      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[0.82rem] font-semibold text-[#101828]">Email Address<RequiredMark /></span>
        <input
          type="email"
          name="email"
          placeholder="Enter your email address"
          value={personalForm.email}
          onChange={(e) => setPersonalField("email", e.target.value)}
          autoComplete="email" data-allow-autofill="true"
          className={desktopInputClassName}
          style={{ fontFamily: "Poppins, sans-serif" }}
        />
      </label>

      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[0.82rem] font-semibold text-[#101828]">Address<RequiredMark /></span>
        <textarea
          name="company_address"
          placeholder="Enter company address"
          value={companyForm.company_address}
          onChange={(e) => setCompanyField("company_address", e.target.value)}
          rows={3}
          className={registerDesktopTextareaClass}
          style={{ fontFamily: "Poppins, sans-serif" }}
        />
      </label>

      <button
        type="submit"
        className="mt-6 h-10 w-full cursor-pointer rounded-[10px] border-0 bg-blue-600 text-[0.95rem] text-white hover:bg-blue-700"
        style={{ fontFamily: "Poppins, sans-serif" }}
      >
        Next
      </button>
    </form>
  );

  const companyFormDesktop = (
    <form className="flex min-h-0 flex-1 flex-col gap-3.5" onSubmit={handleSignUp} data-allow-autofill="true" autoComplete="on">
      <div className="grid grid-cols-2 gap-3.5">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.82rem] font-semibold text-[#101828]">Slug<RequiredMark /></span>
          <input
            type="text"
            name="slug"
            value={companyForm.slug}
            onChange={(e) => setCompanyField("slug", e.target.value)}
            className={desktopInputClassName}
            style={{ fontFamily: "Poppins, sans-serif" }}
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.82rem] font-semibold text-[#101828]">GST Registration</span>
          <input
            type="text"
            name="gst_registration_no"
            value={companyForm.gst_registration_no}
            onChange={(e) => setCompanyField("gst_registration_no", e.target.value)}
            className={desktopInputClassName}
            style={{ fontFamily: "Poppins, sans-serif" }}
          />
        </label>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[0.82rem] font-semibold text-[#101828]">Financial Year<RequiredMark /></span>
        <div className="grid grid-cols-2 gap-3.5">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[0.82rem] font-semibold text-[#101828]">From<RequiredMark /></span>
            <SyncBridgeDatePicker
              value={companyForm.fy_from}
              onChange={(value) => setCompanyField("fy_from", value)}
              placeholder="DD/MM/YYYY"
              className="rounded-[10px] border-gray-200 bg-white text-[0.85rem]"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[0.82rem] font-semibold text-[#101828]">To<RequiredMark /></span>
            <SyncBridgeDatePicker
              value={companyForm.fy_to}
              onChange={(value) => setCompanyField("fy_to", value)}
              placeholder="DD/MM/YYYY"
              min={companyForm.fy_from || undefined}
              className="rounded-[10px] border-gray-200 bg-white text-[0.85rem]"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.82rem] font-semibold text-[#101828]">Password<RequiredMark /></span>
          <div className="relative flex items-center">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              value={personalForm.password}
              onChange={(e) => setPersonalField("password", e.target.value)}
              autoComplete="new-password" data-allow-autofill="true"
              aria-invalid={Boolean(passwordErrors.password)}
              className={`${desktopPasswordInputClassName}${passwordErrors.password ? " border-red-500" : ""}`}
              style={{ fontFamily: "Poppins, sans-serif" }}
            />
            <button
              type="button"
              className="absolute right-3 cursor-pointer border-0 bg-transparent p-1 text-[1.1rem] text-gray-400 hover:text-gray-500"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <FiEyeOff /> : <FiEye />}
            </button>
          </div>
          {passwordErrors.password ? (
            <p className="mb-0 text-[0.72rem] font-medium leading-snug text-red-600">{passwordErrors.password}</p>
          ) : null}
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.82rem] font-semibold text-[#101828]">Confirmation Password<RequiredMark /></span>
          <div className="relative flex items-center">
            <input
              type={showConfirm ? "text" : "password"}
              name="confirm_password"
              value={personalForm.confirm_password}
              onChange={(e) => setPersonalField("confirm_password", e.target.value)}
              autoComplete="new-password" data-allow-autofill="true"
              aria-invalid={Boolean(passwordErrors.confirm_password)}
              className={`${desktopPasswordInputClassName}${passwordErrors.confirm_password ? " border-red-500" : ""}`}
              style={{ fontFamily: "Poppins, sans-serif" }}
            />
            <button
              type="button"
              className="absolute right-3 cursor-pointer border-0 bg-transparent p-1 text-[1.1rem] text-gray-400 hover:text-gray-500"
              onClick={() => setShowConfirm((prev) => !prev)}
              aria-label={showConfirm ? "Hide password" : "Show password"}
            >
              {showConfirm ? <FiEyeOff /> : <FiEye />}
            </button>
          </div>
          {passwordErrors.confirm_password ? (
            <p className="mb-0 text-[0.72rem] font-medium leading-snug text-red-600">{passwordErrors.confirm_password}</p>
          ) : null}
        </label>
      </div>

      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => setStep(1)}
          disabled={loading}
          className="h-10 flex-1 cursor-pointer rounded-[10px] border border-gray-200 bg-white text-[0.95rem] text-[#101828] hover:bg-gray-50 disabled:opacity-70"
          style={{ fontFamily: "Poppins, sans-serif" }}
        >
          Back
        </button>
        <button
          type="submit"
          disabled={loading}
          className="h-10 flex-[1.4] cursor-pointer rounded-[10px] border-0 bg-blue-600 text-[0.95rem] text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          style={{ fontFamily: "Poppins, sans-serif" }}
        >
          {loading ? "Creating account..." : "Sign Up"}
        </button>
      </div>
    </form>
  );

  return (
    <>
      <AuthMobileShell
        title={mobileTitle}
        subtitle={mobileSubtitle}
        footer={<AuthProgressDots total={3} active={progressActive} />}
      >
        {step === 1 ? personalFormMobile : companyFormMobile}
      </AuthMobileShell>

      {/* Same shell as login — only the right box switches to Sign Up */}
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

          <div className="relative z-10 flex h-full w-full flex-col pb-8 pl-12 pr-[min(540px,42%)] pt-12 xl:pl-14 xl:pt-14">
            <aside className="flex min-h-0 flex-1 flex-col">
              <div className="max-w-[520px]">
                <img
                  src={logo}
                  alt="BizOne"
                  className="mb-8 block h-[4.75rem] w-auto object-contain object-left"
                />

                <h1 className="m-0 text-[clamp(2.5rem,3.8vw,3.35rem)] font-extrabold leading-[1.12] tracking-tight">
                  <span className="block whitespace-nowrap text-[#0B1F44]">Smarter Business.</span>
                  <span className="block whitespace-nowrap text-[#2563EB]">Greater Growth.</span>
                </h1>
                <p className="mt-4 max-w-[420px] text-[1.2rem] font-medium leading-[1.55] text-[#64748B]">
                  Powerful ERP Solution to Manage,
                  <br />
                  Automate and Grow Your Business.
                </p>

                <ul className="mt-8 max-w-[250px] space-y-0">
                  {FEATURES.map(({ label, Icon }, index) => (
                    <li
                      key={label}
                      className={`flex items-center gap-3.5 py-[11px] ${
                        index < FEATURES.length - 1 ? "border-b border-[#CBD5E1]/75" : ""
                      }`}
                    >
                      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#93C5FD] bg-white/95 text-[#2563EB] shadow-sm">
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                      </span>
                      <span className="text-[0.98rem] font-semibold text-[#0B1F44]">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-auto flex flex-nowrap items-center gap-x-4 pb-1 pt-10 whitespace-nowrap">
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

          {/* Auth box — same original 520×580 size/place as Sign In */}
          <section
            className="absolute top-1/2 z-20 -translate-y-1/2"
            style={{ left: "62%", right: "2%" }}
          >
            <div className="ml-auto flex w-[520px] max-w-full flex-col rounded-[22px] bg-white px-10 pb-8 pt-9 shadow-[0_24px_60px_rgba(2,12,40,0.28)]">
              <div className="mb-5 shrink-0 text-center">
                <h2 className="m-0 text-[1.85rem] font-bold tracking-tight text-[#101828]">
                  {desktopTitle}
                </h2>
                <p className="mx-auto mt-2 max-w-[380px] text-[0.9rem] leading-relaxed text-gray-500">
                  {mobileSubtitle}
                </p>
              </div>

              <div className="flex flex-col">
                {step === 1 ? personalFormDesktop : companyFormDesktop}
              </div>

              <p className="mb-0 shrink-0 pt-5 text-center text-[0.9rem] text-gray-600">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-blue-600 no-underline hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
