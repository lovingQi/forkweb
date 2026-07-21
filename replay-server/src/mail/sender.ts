import nodemailer from 'nodemailer';
import type { DbTicket } from '../db/tickets';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: string;
  to: string[];
}

function getMailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const from = process.env.SMTP_FROM;
  const to = process.env.SMTP_TO;
  if (!host || !port || !from || !to) return null;
  return {
    host,
    port: Number(port),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
    from,
    to: to.split(',').map((s) => s.trim()).filter(Boolean)
  };
}

export function isMailConfigured(): boolean {
  return getMailConfig() !== null;
}

export async function sendRdNotificationEmail(ticket: DbTicket, ticketUrl: string): Promise<void> {
  const config = getMailConfig();
  if (!config) {
    console.warn('[mail] SMTP 未配置，跳过邮件通知');
    return;
  }
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth
  });
  const conclusion = ticket.conclusion || '（自动分析尚未完成或失败）';
  await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject: `[forkweb 工单] #${ticket.ticket_no} 需要研发介入`,
    text: `工单 #${ticket.ticket_no} 已由售后人员标记为「需要研发介入」。

标题: ${ticket.title}
描述: ${ticket.description}
自动分析结论: ${conclusion}

请登录系统查看详情并处理：
${ticketUrl}
`,
    html: `<p>工单 <strong>#${ticket.ticket_no}</strong> 已由售后人员标记为「需要研发介入」。</p>
<p><strong>标题:</strong> ${ticket.title}</p>
<p><strong>描述:</strong> ${ticket.description}</p>
<p><strong>自动分析结论:</strong> ${conclusion}</p>
<p><a href="${ticketUrl}">点击此处查看工单详情</a></p>`
  });
}
