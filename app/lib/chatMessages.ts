export type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ChatRequestMessage { role: 'user' | 'assistant'; content: string | ChatContentPart[] }
export type ChatMode = 'sentence' | 'free';
export const CHAT_IMAGE_FILE_LIMIT = 2 * 1024 * 1024;
export const CHAT_BODY_LIMIT = 9 * 1024 * 1024;
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Accept only bounded inline raster images; never forward arbitrary remote URLs. */
export function validateChatMessages(value: unknown, vision: boolean, mode: ChatMode = 'free'): ChatRequestMessage[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new Error('聊天消息数量无效。');
  return value.map(item => {
    if (!item || typeof item !== 'object' || !['user', 'assistant'].includes(item.role)) throw new Error('聊天消息格式无效。');
    const role = item.role as ChatRequestMessage['role'];
    if (typeof item.content === 'string' && item.content.length <= 100_000) return { role, content: item.content };
    if (role !== 'user' || !Array.isArray(item.content) || !item.content.length || item.content.length > 5) throw new Error('聊天消息内容无效。');
    const content: ChatContentPart[] = item.content.map((part: unknown) => {
      if (!part || typeof part !== 'object') throw new Error('聊天消息内容无效。');
      const p = part as Record<string, unknown>;
      if (p.type === 'text' && typeof p.text === 'string' && p.text.length <= 100_000) return { type: 'text', text: p.text };
      const image = p.image_url as { url?: unknown } | undefined;
      if (p.type !== 'image_url' || typeof image?.url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.url)
        || image.url.length > Math.ceil(CHAT_IMAGE_FILE_LIMIT / 3) * 4 + 64) throw new Error('请上传不超过 2 MB 的 PNG、JPEG 或 WebP 图片。');
      if (mode !== 'free') throw new Error('只有自由聊天可以上传图片。');
      if (!vision) throw new Error('当前模型不支持图片聊天，请切换到支持图片输入的模型。');
      return { type: 'image_url', image_url: { url: image.url } };
    });
    return { role, content };
  });
}
