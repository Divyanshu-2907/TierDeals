/** Saves `text` as a file through the browser's normal download flow. */
export function downloadTextFile(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled, or some browsers cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
