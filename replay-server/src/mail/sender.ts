import nodemailer from 'nodemailer';
import fs from 'fs/promises';
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

export interface RdNotificationContext {
  analysisVersionId?: number | null;
  stepStatusSummary?: Record<string, { toStatus: string | null; reason: string | null }>;
  reportPath?: string | null;
  packagePath?: string | null;
}

async function existingAttachments(context: RdNotificationContext) {
  const candidates = [
    { path: context.reportPath, filename: 'report.md' },
    { path: context.packagePath, filename: 'package.zip' }
  ];
  const attachments: Array<{ path: string; filename: string }> = [];
  for (const candidate of candidates) {
    if (!candidate.path) continue;
    try {
      await fs.access(candidate.path);
      attachments.push({ path: candidate.path, filename: candidate.filename });
    } catch {
      // 文件可能已被清理，仍发送包含工单链接的通知。
    }
  }
  return attachments;
}

export async function sendRdNotificationEmail(
  ticket: DbTicket,
  ticketUrl: string,
  context: RdNotificationContext = {}
): Promise<void> {
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
  const attachments = await existingAttachments(context);
  const stepStatusText = Object.entries(context.stepStatusSummary || {})
    .map(([key, value]) => `${key}: ${value.toStatus || 'unchecked'}${value.reason ? `（${value.reason}）` : ''}`)
    .join('\n') || '暂无步骤执行记录';
  await transporter.sendMail({
    from: config.from,
    to: config.to,
    subject: `[forkweb 工单] #${ticket.ticket_no} 需要研发介入`,
    text: `工单 #${ticket.ticket_no} 已由售后人员标记为「需要研发介入」。

标题: ${ticket.title}
描述: ${ticket.description}
自动分析结论: ${conclusion}
分析版本: ${context.analysisVersionId || '暂无'}
报告: ${context.reportPath || '暂无'}
诊断包: ${context.packagePath || '暂无'}
步骤状态:
${stepStatusText}

请登录系统查看详情并处理：
${ticketUrl}
`,
    html: `<p>工单 <strong>#${ticket.ticket_no}</strong> 已由售后人员标记为「需要研发介入」。</p>
<p><strong>标题:</strong> ${ticket.title}</p>
<p><strong>描述:</strong> ${ticket.description}</p>
<p><strong>自动分析结论:</strong> ${conclusion}</p>
<p><strong>分析版本:</strong> ${context.analysisVersionId || '暂无'}</p>
<p><strong>步骤状态:</strong></p><pre>${stepStatusText}</pre>
<p><a href="${ticketUrl}">点击此处查看工单详情</a></p>`
    ,attachments
  });
}
