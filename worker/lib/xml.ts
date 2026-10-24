const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** Makes text safe inside an XML element or a quoted attribute. */
export const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
