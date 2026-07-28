export type VisibleAttachment = {
  fallback?: string;
  title?: string;
  text?: string;
  fields?: Array<{ title?: string; value?: string }>;
};

export type NormalizedMessage = {
  ts: string;
  userId: string;
  text: string;
  content: string;
  thread_ts?: string;
  files?: any[];
  attachments?: VisibleAttachment[];
};

function add(parts: string[], value: unknown) {
  if (typeof value !== "string") return;
  const text = value.trim();
  if (text && !parts.includes(text)) parts.push(text);
}

function blockText(block: any, parts: string[]) {
  if (!block || typeof block !== "object") return;
  if (typeof block.text === "string") add(parts, block.text);
  else if (block.text && typeof block.text === "object") blockText(block.text, parts);
  if (typeof block.title === "string") add(parts, block.title);
  if (typeof block.value === "string") add(parts, block.value);
  for (const key of ["elements", "content", "fields"]) {
    if (Array.isArray(block[key])) for (const child of block[key]) blockText(child, parts);
  }
}

export function visibleAttachments(message: any): VisibleAttachment[] | undefined {
  const attachments = (message.attachments || []).map((attachment: any) => ({
    ...(attachment.fallback ? { fallback: attachment.fallback } : {}),
    ...(attachment.title ? { title: attachment.title } : {}),
    ...(attachment.text ? { text: attachment.text } : {}),
    ...(attachment.fields?.length ? {
      fields: attachment.fields.map((field: any) => ({
        ...(field.title ? { title: field.title } : {}),
        ...(field.value ? { value: field.value } : {}),
      })),
    } : {}),
  }));
  return attachments.length ? attachments : undefined;
}

/** Returns every human-visible text fragment Slack exposes for a message. */
export function visibleContent(message: any): string {
  const parts: string[] = [];
  add(parts, message.text);
  for (const block of message.blocks || []) blockText(block, parts);
  for (const attachment of message.attachments || []) {
    add(parts, attachment.fallback);
    add(parts, attachment.pretext);
    add(parts, attachment.title);
    add(parts, attachment.text);
    for (const field of attachment.fields || []) {
      add(parts, field.title);
      add(parts, field.value);
    }
  }
  return parts.filter(part => !parts.some(other => other !== part && other.includes(part))).join("\n");
}

export function normalizeMessage(message: any): NormalizedMessage {
  const text = message.text || "";
  return {
    ts: message.ts || "",
    userId: message.user || message.bot_id || "",
    text,
    content: visibleContent(message),
    ...(message.thread_ts && message.thread_ts !== message.ts ? { thread_ts: message.thread_ts } : {}),
    ...(message.files?.length ? { files: message.files } : {}),
    ...(visibleAttachments(message) ? { attachments: visibleAttachments(message) } : {}),
  };
}
