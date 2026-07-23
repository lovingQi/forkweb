import axios from 'axios';

export interface WechatWorkMessage {
  title?: string;
  text: string;
  markdown?: string;
}

export function isWechatWorkConfigured(): boolean {
  return Boolean(process.env.WECHAT_WORK_WEBHOOK_URL);
}

export async function sendWechatWorkNotification(message: WechatWorkMessage): Promise<void> {
  const url = process.env.WECHAT_WORK_WEBHOOK_URL;
  if (!url) {
    // 未配置时静默跳过
    return;
  }

  const body = message.markdown || message.text;
  const content = message.title ? `**${message.title}**\n\n${body}` : body;

  try {
    await axios.post(
      url,
      {
        msgtype: 'markdown',
        markdown: { content }
      },
      { timeout: 10000 }
    );
  } catch (e) {
    console.warn('[wechat-work] 通知发送失败:', e instanceof Error ? e.message : String(e));
  }
}
