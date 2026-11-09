/**
 * R6 SMTP transport: configuration from environment, honest acceptance-based
 * status, and a credential-free transport-status endpoint.
 */
import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { SmtpTransport, smtpConfigFromEnv } from "./smtp.js";
import { UnconfiguredTransport } from "./service.js";

describe("smtpConfigFromEnv", () => {
  it("returns null without a host - the honest unconfigured path", () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: "  " })).toBeNull();
  });

  it("reads host/port/secure/user/from; status never exposes the password", () => {
    const config = smtpConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "ops@example.com",
      SMTP_PASS: "secret",
      SMTP_FROM: "PrivateFleet <no-reply@example.com>",
    });
    expect(config).not.toBeNull();
    expect(config!.host).toBe("smtp.example.com");
    expect(config!.port).toBe(465);
    expect(config!.secure).toBe(true);
    expect(config!.from).toBe("PrivateFleet <no-reply@example.com>");
    // The credential lives in the config (needed to send); the STATUS
    // endpoint must never leak it.
    const status = new SmtpTransport(config!).status();
    expect(JSON.stringify(status)).not.toContain("secret");
  });
});

describe("SmtpTransport", () => {
  it("records sent ONLY when the SMTP server accepts the message", async () => {
    // jsonTransport: in-memory, no network - perfect for unit evidence.
    const jsonTransport = nodemailer.createTransport({ jsonTransport: true });
    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: null,
        pass: null,
        from: "PrivateFleet <no-reply@example.com>",
      },
      jsonTransport,
    );
    const result = await transport.send({
      to: "customer@example.com",
      subject: "Your delivery is complete",
      bodyText: "Open the tracking link you received from dispatch.",
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("accepted by SMTP server");
  });

  it("records failure honestly when the transport rejects", async () => {
    const failing = {
      sendMail: async () => {
        throw new Error("connection refused");
      },
    };
    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: null,
        pass: null,
        from: "PrivateFleet <no-reply@example.com>",
      },
      failing as never,
    );
    const result = await transport.send({ to: "x@example.com", subject: "s", bodyText: "b" });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("connection refused");
  });

  it("status() never leaks credentials", () => {
    const transport = new SmtpTransport({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "ops@example.com",
      pass: "top-secret",
      from: "PrivateFleet <no-reply@example.com>",
    });
    const status = transport.status();
    expect(status.configured).toBe(true);
    expect(status.host).toBe("smtp.example.com");
    expect(JSON.stringify(status)).not.toContain("top-secret");
  });

  it("unconfigured transport stays honest", async () => {
    const result = await new UnconfiguredTransport().send();
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("SMTP not configured");
  });
});
