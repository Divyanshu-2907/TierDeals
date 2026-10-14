/**
 * The `error` prop for a Polaris field: present only when there is an error,
 * since Polaris types do not accept `error={undefined}` under
 * exactOptionalPropertyTypes. Use as `{...fieldError(errors, 'title')}`.
 */
export function fieldError(errors: Record<string, string>, key: string): { error?: string } {
  const message = errors[key];
  return message === undefined ? {} : { error: message };
}
