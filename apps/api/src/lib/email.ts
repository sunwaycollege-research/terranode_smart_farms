// SMTP email (nodemailer). Used to send a welcome email when an admin creates a
// customer account. Configured entirely from env:
//
//   SMTP_HOST   (required to enable email; if unset, sending is skipped + logged)
//   SMTP_PORT   (default 587; 1025 for Mailpit in dev)
//   SMTP_SECURE ('true' for implicit TLS / port 465)
//   SMTP_USER / SMTP_PASS  (optional; omit for an open relay like Mailpit)
//   SMTP_FROM   (default 'TERANODE <no-reply@teranode.local>')
//   APP_LOGIN_URL (where the customer signs in; default http://localhost:5173)
//
// Sending is best-effort: callers must not let an email failure break their flow.

import nodemailer, { type Transporter } from 'nodemailer';

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT ?? 587);
const SECURE = process.env.SMTP_SECURE === 'true';
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.SMTP_FROM ?? 'TERANODE <no-reply@teranode.local>';
const LOGIN_URL = process.env.APP_LOGIN_URL ?? 'http://localhost:5173';

let transporter: Transporter | null = null;

/** Lazily build the shared transport, or null if SMTP is not configured. */
function getTransport(): Transporter | null {
  if (!HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: SECURE,
      auth: USER ? { user: USER, pass: PASS } : undefined,
    });
  }
  return transporter;
}

/** Whether SMTP is configured (an email would actually be attempted). */
export function emailEnabled(): boolean {
  return Boolean(HOST);
}

export interface SendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

export interface WelcomeEmailArgs {
  to: string;
  name: string;
  /** The initial password the admin set (the farmer should change it after first sign-in). */
  tempPassword: string;
}

/** Send the "your TERANODE account is ready" welcome email. Best-effort. */
export async function sendWelcomeEmail(args: WelcomeEmailArgs): Promise<SendResult> {
  const t = getTransport();
  if (!t) return { sent: false, reason: 'SMTP not configured (set SMTP_HOST)' };

  const subject = 'Welcome to TERANODE — your account is ready';
  const text =
    `Hi ${args.name},\n\n` +
    `Your TERANODE account has been created. You can now sign in to the TERANODE app to ` +
    `monitor and manage your farm.\n\n` +
    `Sign in: ${LOGIN_URL}\n` +
    `Email: ${args.to}\n` +
    `Temporary password: ${args.tempPassword}\n\n` +
    `For your security, please change your password after your first sign-in.\n\n` +
    `— The TERANODE team`;
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#1a1916">` +
    `<h2 style="color:#3f6b4e">🌱 Welcome to TERANODE</h2>` +
    `<p>Hi ${escapeHtml(args.name)},</p>` +
    `<p>Your TERANODE account has been created. You can now sign in to the TERANODE app to ` +
    `monitor and manage your farm.</p>` +
    `<table style="border-collapse:collapse;margin:16px 0">` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b6457">Email</td><td><b>${escapeHtml(args.to)}</b></td></tr>` +
    `<tr><td style="padding:4px 12px 4px 0;color:#6b6457">Temporary password</td><td><code>${escapeHtml(args.tempPassword)}</code></td></tr>` +
    `</table>` +
    `<p><a href="${LOGIN_URL}" style="background:#3f6b4e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Sign in</a></p>` +
    `<p style="color:#6b6457;font-size:13px">For your security, please change your password after your first sign-in.</p>` +
    `</div>`;

  try {
    const info = await t.sendMail({ from: FROM, to: args.to, subject, text, html });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: (err as Error).message };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
