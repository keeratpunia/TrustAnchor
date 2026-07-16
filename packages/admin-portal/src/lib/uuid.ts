/** generateUuid — crypto.randomUUID() where available (any modern browser
 * on localhost or HTTPS), with an RFC4122-ish fallback for anywhere it
 * isn't (e.g. opened over plain HTTP on a non-localhost hostname). */
export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
