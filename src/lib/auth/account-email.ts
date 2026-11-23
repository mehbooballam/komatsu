type AccountEmailPurpose = "invitation" | "password-reset";

const EMAIL_DETAILS = {
  invitation: {
    path: "/accept-invite",
    subject: "Your RiskOrbit workspace invitation",
    instructions: "Open this link to join your RiskOrbit workspace. The link expires in seven days.",
  },
  "password-reset": {
    path: "/reset-password",
    subject: "Reset your RiskOrbit password",
    instructions: "Open this link to reset your RiskOrbit password. The link expires in one hour.",
  },
} satisfies Record<AccountEmailPurpose, { path: string; subject: string; instructions: string }>;

/** Use a configured origin so incoming request headers cannot change email link destinations. */
export function getAccountMailer() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  const baseUrl = process.env.NEXTAUTH_URL?.trim();
  if (!apiKey || !from || !baseUrl || !URL.canParse(baseUrl)) return null;
  const origin = new URL(baseUrl);
  if (origin.username || origin.password) return null;

  const localDev = process.env.NODE_ENV !== "production" && origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !localDev) return null;

  return async function deliver(purpose: AccountEmailPurpose, email: string, token: string) {
    const { path, subject, instructions } = EMAIL_DETAILS[purpose];
    const link = new URL(path, origin);
    // URL fragments stay in the browser and out of request URLs and access logs.
    link.hash = new URLSearchParams({ token }).toString();
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [email], subject, text: `${instructions}\n\n${link}` }),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return true;
      console.error("Account email rejected by provider", { purpose, status: response.status });
    } catch {
      console.error("Account email provider request failed", { purpose });
    }
    return false;
  };
}
