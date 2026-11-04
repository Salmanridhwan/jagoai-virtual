import type { ScreenshotDocument } from "@openpost/query-catalog";

export type ScreenshotElement =
  | {
      kind: "text";
      x: number;
      y: number;
      value: string;
      size: number;
      color: string;
      weight?: "bold";
      anchor?: "middle" | "end";
      mono?: boolean;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      radius?: number;
    }
  | { kind: "image"; x: number; y: number; width: number; height: number; mediaId: string };
export type ScreenshotLayout = {
  height: number;
  background: string;
  elements: ScreenshotElement[];
};

// Conservative glyph widths keep long words, emoji, and CJK inside the exported artifact.
function measureText(text: string, size: number) {
  return Array.from(text).reduce(
    (sum, c) => sum + (/[^\u0000-\u024f]/u.test(c) ? size : c === " " ? size * 0.32 : size * 0.62),
    0,
  );
}

function screenshotLines(value: string, width: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let line = "";
    let used = 0;
    const parts = paragraph.match(/\S+\s*|\s+/gu) ?? [""];
    for (const part of parts) {
      const measure = (text: string) => measureText(text, size);
      if (line && used + measure(part) > width) {
        lines.push(line.trimEnd());
        line = "";
        used = 0;
      }
      for (const glyph of part) {
        const next = measure(glyph);
        if (line && used + next > width) {
          lines.push(line.trimEnd());
          line = "";
          used = 0;
        }
        line += glyph;
        used += next;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function screenshotLayout(doc: ScreenshotDocument): ScreenshotLayout {
  const dark = doc.appearance === "dark";
  const ink = dark ? "#f5f5f7" : "#161618";
  const muted = dark ? "#b0b0b8" : "#62626a";
  const background = dark ? "#111113" : "#ffffff";
  const elements: ScreenshotElement[] = [];
  const size = doc.text_size === "large" ? 27 : doc.text_size === "small" ? 19 : 23;
  let y = 32;
  function text(
    value: string,
    x = 32,
    width = 476,
    fontSize = size,
    color = ink,
    anchor?: "middle" | "end",
    bold = false,
    mono = false,
  ) {
    const lines = screenshotLines(value, width, fontSize);
    for (const line of lines) {
      elements.push({
        kind: "text",
        x,
        y: y + fontSize,
        value: line,
        size: fontSize,
        color,
        anchor,
        weight: bold ? "bold" : undefined,
        mono,
      });
      y += fontSize * 1.4;
    }
  }
  function divider() {
    elements.push({
      kind: "rect",
      x: 32,
      y,
      width: 476,
      height: 1,
      color: dark ? "#3a3a40" : "#dedee4",
    });
    y += 24;
  }
  if (doc.conversation) {
    const chat = doc.conversation;
    if (chat.show_header) {
      elements.push({
        kind: "rect",
        x: 0,
        y: 0,
        width: 540,
        height: 134,
        color: dark ? "#242426" : "#f2f2f7",
      });
      const people =
        doc.template_id === "group-chat"
          ? chat.people.slice(0, 4)
          : [chat.people.find((person) => person.id !== chat.self_id)].filter(
              (person) => person !== undefined,
            );
      const left = 270 - people.length * 22;
      people.forEach((person, i) => {
        const x = left + i * 44;
        elements.push({
          kind: "rect",
          x,
          y: 22,
          width: 42,
          height: 42,
          radius: 21,
          color: "#9699a2",
        });
        if (person.avatar_media_id)
          elements.push({
            kind: "image",
            x,
            y: 22,
            width: 42,
            height: 42,
            mediaId: person.avatar_media_id,
          });
        else
          elements.push({
            kind: "text",
            x: x + 21,
            y: 51,
            value: person.name.slice(0, 1).toUpperCase(),
            size: 23,
            color: "#fff",
            anchor: "middle",
          });
      });
      y = 76;
      text(chat.name, 270, 400, 21, ink, "middle");
      y = Math.max(y + 20, 152);
    }
    if (chat.timestamp) {
      text(chat.timestamp, 270, 460, 16, muted, "middle");
      y += 18;
    }
    chat.messages.forEach((message, index) => {
      const outgoing = message.sender_id === chat.self_id;
      const sender = chat.people.find((person) => person.id === message.sender_id);
      if (
        doc.template_id === "group-chat" &&
        !outgoing &&
        chat.messages[index - 1]?.sender_id !== message.sender_id
      )
        text(sender?.name ?? "", 30, 380, 16, muted);
      const lines = screenshotLines(message.text, 330, size);
      const bubbleWidth = message.image_media_id
        ? 370
        : Math.min(370, Math.max(74, ...lines.map((line) => measureText(line, size) + 32)));
      const x = outgoing ? 514 - bubbleWidth : 26;
      const textHeight = message.text
        ? screenshotLines(message.text, bubbleWidth - 32, size).length * size * 1.4 + 24
        : 0;
      const imageHeight = message.image_media_id ? 250 : 0;
      elements.push({
        kind: "rect",
        x,
        y,
        width: bubbleWidth,
        height: textHeight + imageHeight,
        radius: 22,
        color: outgoing ? "#007aff" : dark ? "#303034" : "#e9e9eb",
      });
      if (message.text) {
        y += 12;
        text(message.text, x + 16, bubbleWidth - 32, size, outgoing ? "#fff" : ink);
        y += 12;
      }
      if (message.image_media_id) {
        elements.push({
          kind: "image",
          x: x + 8,
          y,
          width: bubbleWidth - 16,
          height: 242,
          mediaId: message.image_media_id,
        });
        y += 250;
      }
      y += chat.messages[index + 1]?.sender_id === message.sender_id ? 8 : 20;
    });
    if (chat.read_receipt) text(chat.read_receipt, 514, 450, 16, muted, "end");
  } else if (doc.receipt) {
    const receipt = doc.receipt;
    text(receipt.business, 270, 440, 28, ink, "middle", true, true);
    if (receipt.address) text(receipt.address, 270, 440, 17, ink, "middle", false, true);
    y += 18;
    text(receipt.timestamp, 32, 476, 17, ink, undefined, false, true);
    if (receipt.order) text(receipt.order, 32, 476, 17, ink, undefined, false, true);
    y += 16;
    divider();
    const money = (cents: number) =>
      new Intl.NumberFormat("en", { style: "currency", currency: receipt.currency }).format(
        cents / 100,
      );
    let subtotal = 0;
    for (const item of receipt.items) {
      const top = y;
      text(`${item.quantity} × ${item.name}`, 32, 320, 20, ink, undefined, false, true);
      const bottom = y;
      y = top;
      text(money(item.amount_cents * item.quantity), 508, 128, 20, ink, "end", false, true);
      y = Math.max(y, bottom) + 16;
      subtotal += item.amount_cents * item.quantity;
    }
    divider();
    const tax = Math.round((subtotal * receipt.tax_percent) / 100);
    function total(label: string, amount: string, bold = false) {
      const top = y;
      text(label, 32, 300, 21, ink, undefined, bold, true);
      const bottom = y;
      y = top;
      text(amount, 508, 158, 21, ink, "end", bold, true);
      y = Math.max(y, bottom) + 10;
    }
    total("Subtotal", money(subtotal));
    total(`Tax (${receipt.tax_percent}%)`, money(tax));
    total("TOTAL", receipt.custom_total || money(subtotal + tax), true);
    y += 18;
    if (receipt.footer) text(receipt.footer, 270, 440, 18, ink, "middle", false, true);
  } else if (doc.status_page) {
    const status = doc.status_page;
    text(status.name, 32, 476, 28, ink, undefined, true);
    y += 20;
    const color =
      status.severity === "operational"
        ? "#187849"
        : status.severity === "degraded"
          ? "#955c00"
          : "#b62424";
    const top = y;
    y += 20;
    text(status.headline, 52, 436, 25, "#fff", undefined, true);
    y += 20;
    elements.unshift({
      kind: "rect",
      x: 32,
      y: top,
      width: 476,
      height: y - top,
      radius: 8,
      color,
    });
    y += 28;
    for (const update of status.updates) {
      text(update.stage, 32, 476, 21, ink, undefined, true);
      if (update.timestamp) text(update.timestamp, 32, 476, 16, muted);
      y += 10;
      text(update.text);
      y += 24;
      divider();
    }
  } else throw new Error("This post has no supported screenshot recipe.");
  const height = Math.ceil(
    Math.max(y + 32, doc.frame === "portrait" ? 675 : doc.frame === "square" ? 540 : 240),
  );
  if (height > 4096)
    throw new Error("This visual is too tall to export. Shorten its text before using it.");
  return { height, background, elements };
}
