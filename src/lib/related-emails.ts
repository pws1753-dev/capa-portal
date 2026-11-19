const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Converts comma, semicolon or newline-separated input to the normalized list stored on a complaint. */
export function parseRelatedEmails(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,;\n]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function hasOnlyValidRelatedEmails(value: string): boolean {
  return parseRelatedEmails(value).every((email) => EMAIL_PATTERN.test(email));
}
