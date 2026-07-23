import { sendWechatWorkNotification } from '../src/notify/wechatWork';

async function main() {
  console.log('Verify wechat work notification...');
  await sendWechatWorkNotification({
    title: '测试通知',
    text: '这是一条企业微信测试通知，当未配置 WECHAT_WORK_WEBHOOK_URL 时应静默跳过。'
  });
  console.log('Done without error.');
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
