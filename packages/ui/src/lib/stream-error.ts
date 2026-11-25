/**
 * How a failed run reads in the timeline.
 *
 * The agent's error text is written for its own CLI:
 *
 *   No API key found for the selected model. Use /login to log into a provider
 *   via OAuth or API key. See: D:\Program Files\PiWork\resources\app.asar\
 *   node_modules\@earendil-works\pi-coding-agent\docs\providers.md …
 *
 * In this app the fix is 设置 → 模型, not a `/login` command, and the `See:`
 * paths point inside an asar that does not exist on the reader's disk. So the
 * two cases are told apart here: a missing credential is answered in the app's
 * own words (the timeline offers 设置 → 模型 rather than repeating the CLI's
 * advice), anything else shows the error with that documentation tail removed.
 */

export type StreamErrorKind =
  /** A missing or rejected model credential — Settings → 模型 is the fix. */
  | 'configuration'
  /** Anything else: the provider failed, the network dropped, a tool threw. */
  | 'other';

/**
 * What the agent says when the selected model has no usable credential. Kept
 * narrow on purpose: "not configured" alone would also match unrelated tool
 * errors, and sending someone to the model settings for those wastes a click.
 */
const CREDENTIAL_HINTS: readonly RegExp[] = [
  /\bno api[ _-]?key\b/i,
  /\bmissing api[ _-]?key\b/i,
  // "Invalid API key provided", but also the wire form "invalid x-api-key".
  /\b(?:invalid|incorrect|expired|revoked)\b[^.!?]{0,40}\bapi[ _-]?key\b/i,
  /\bapi[ _-]?key\b[^.!?]{0,80}\b(?:missing|not (?:set|found|configured|provided)|invalid|incorrect|expired)\b/i,
  // A provider rejecting the credential outright (401 from an OpenAI-shaped
  // endpoint reads `"type":"authentication_error"`).
  /\b(?:authentication|unauthorized)[ _-]?error\b/i,
  // The agent's own remedy for the case above; it only appears for credentials.
  /\buse \/login\b/i,
  /(?:未配置|尚未配置|没有配置)[^。！？]{0,20}(?:api\s*key|密钥|凭据|模型)/i,
];

/** Whether the failure is a credential problem the model settings can fix. */
export function classifyStreamError(error: string): StreamErrorKind {
  return CREDENTIAL_HINTS.some((pattern) => pattern.test(error)) ? 'configuration' : 'other';
}

/**
 * The error as one readable line.
 *
 * Whitespace is collapsed (the agent wraps its messages), and the `See: …`
 * documentation tail — a run of absolute paths into the packaged app — is cut
 * off when there is a sentence left over. An error that is nothing but that
 * tail is returned whole: better a noisy message than an empty one.
 */
export function cleanStreamError(error: string): string {
  const oneLine = error.replace(/\s+/g, ' ').trim();
  const withoutDocs = oneLine.replace(/\s*\bSee:\s.*$/i, '').trim();
  return withoutDocs || oneLine;
}
