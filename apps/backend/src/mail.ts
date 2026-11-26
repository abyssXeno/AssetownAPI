import fs from "node:fs";
import path from "node:path";
import { config, MAIL_OUTBOX } from "./env.js";

interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: import("nodemailer").Transporter | null = null;

async function getTransporter(): Promise<import("nodemailer").Transporter | null> {
  if (!config.smtp.host) return null;
  if (transporter) return transporter;
  const nodemailer = await import("nodemailer");
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

export async function sendMail(mail: Mail): Promise<{ delivered: boolean; stored?: string }> {
  const client = await getTransporter();
  if (client) {
    try {
      await client.sendMail({ from: config.smtp.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
      return { delivered: true };
    } catch (error) {
      console.error("[mail] échec SMTP:", (error as Error).message);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(MAIL_OUTBOX, `${stamp}-${mail.to.replace(/[^a-zA-Z0-9@._-]/g, "_")}.txt`);
  fs.writeFileSync(
    file,
    [`To: ${mail.to}`, `Subject: ${mail.subject}`, "", mail.text, "", mail.html ?? ""].join("\n"),
    "utf8",
  );
  return { delivered: false, stored: file };
}

export function verificationEmail(username: string, link: string): Mail {
  return {
    to: "",
    subject: "Assetown — confirmez votre adresse e-mail",
    text: `Bonjour ${username},\n\nConfirmez votre adresse e-mail pour activer toutes les fonctionnalités du launcher Assetown :\n${link}\n\nCe lien expire dans 24 heures.\n\n— L'équipe Assetown`,
    html: `<p>Bonjour <strong>${username}</strong>,</p><p>Confirmez votre adresse e-mail pour sécuriser votre compte Assetown :</p><p><a href="${link}">Confirmer mon adresse</a></p><p>Ce lien expire dans 24 heures.</p>`,
  };
}

export function resetEmail(username: string, link: string): Mail {
  return {
    to: "",
    subject: "Assetown — réinitialisation du mot de passe",
    text: `Bonjour ${username},\n\nUne réinitialisation de mot de passe a été demandée. Si vous êtes à l'origine de cette demande, ouvrez ce lien :\n${link}\n\nCe lien expire dans 60 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.\n\n— L'équipe Assetown`,
    html: `<p>Bonjour <strong>${username}</strong>,</p><p>Réinitialisation du mot de passe demandée :</p><p><a href="${link}">Choisir un nouveau mot de passe</a></p><p>Ce lien expire dans 60 minutes.</p>`,
  };
}
