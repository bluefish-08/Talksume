import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpMailer implements Mailer {
  readonly #transport: Transporter;
  readonly #from: string;

  constructor(config: SmtpConfig) {
    this.#from = config.from;
    this.#transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      ...(config.user && { auth: { user: config.user, pass: config.pass ?? "" } }),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.#transport.sendMail({ from: this.#from, ...message });
  }
}

/** 开发模式：邮件正文打到日志，从日志里取链接。 */
export class LogMailer implements Mailer {
  readonly #log: (line: string) => void;

  constructor(log: (line: string) => void) {
    this.#log = log;
  }

  async send(message: MailMessage): Promise<void> {
    this.#log(`[dev-mail] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}

/** 测试用：收集发出的邮件。 */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  last(to?: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => !to || m.to === to);
  }
}

export function mailerFromEnv(
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
  production: boolean,
): Mailer {
  const host = env.SMTP_HOST?.trim();
  if (host) {
    return new SmtpMailer({
      host,
      port: Number(env.SMTP_PORT ?? 587),
      ...(env.SMTP_USER && { user: env.SMTP_USER }),
      ...(env.SMTP_PASS && { pass: env.SMTP_PASS }),
      from: env.SMTP_FROM?.trim() || "简聊 <no-reply@localhost>",
    });
  }
  if (production)
    throw new Error("生产模式必须配置 SMTP：请设置 SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASS、SMTP_FROM");
  return new LogMailer(log);
}
