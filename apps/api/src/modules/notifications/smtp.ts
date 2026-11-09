/**
 * R6 SMTP transport (notifications module): a real email transport reading
 * configuration from environment variables. Absent configuration means the
 * service keeps using UnconfiguredTransport - the honesty contract never
 * changes: 'sent' is written only when the SMTP server accepted the message.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { NotificationInput, NotificationTransport } from "./service.js";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
}

/**
 * Build SMTP configuration from environment variables; returns null when the
 * required host is missing (caller falls back to the honest unconfigured
 * transport).
 */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  return {
    host,
    port: Number(env.SMTP_PORT ?? 587),
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER?.trim() || null,
    pass: env.SMTP_PASS ?? null,
    from: env.SMTP_FROM?.trim() || "PrivateFleet <no-reply@privatefleet.example>",
  };
}

export class SmtpTransport implements NotificationTransport {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig, transporter?: Transporter) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
      });
  }

  async send(input: NotificationInput): Promise<{ ok: boolean; detail?: string }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: input.to,
        subject: input.subject,
        text: input.bodyText,
      });
      // 'sent' is written only when the SMTP server ACCEPTED the message
      // (sendMail resolved). Acceptance is not proof of recipient delivery,
      // and this transport never claims more than acceptance.
      return { ok: true, detail: `accepted by SMTP server (message id ${info.messageId})` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "SMTP delivery failed" };
    }
  }

  /** Honest status for the configuration endpoint; never leaks credentials. */
  status(): { configured: true; host: string; port: number; from: string } {
    return { configured: true, host: this.config.host, port: this.config.port, from: this.config.from };
  }
}
