/**
 * WhatsApp's link that opens it with `text` already written, to pick who to send it to (spec, 9.2 and 9.4). Every
 * character goes encoded, so a "#", a "&" or a "+" in a name or a note can't cut it short or change it.
 */
export function whatsAppLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
