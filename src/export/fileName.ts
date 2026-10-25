// Export file names: `<project>-<size>.pdf`, `<project>-<n>-sizes.pdf`, `<project>-<view>-<size>.png`.
// Characters that aren't allowed in file names (on any common system) become "-".

/** A name part safe for a file name: forbidden and control characters → "-", runs of "-" and spaces tidied. */
export function namePart(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .replace(/^[-.\s]+|[-.\s]+$/g, '');
}

const project = (name: string) => namePart(name) || 'project';

export function pdfFileName(projectName: string, sizeNames: string[]): string {
  const sizes = sizeNames.length === 1 ? namePart(sizeNames[0]) || 'size' : `${sizeNames.length}-sizes`;
  return `${project(projectName)}-${sizes}.pdf`;
}

export function pngFileName(projectName: string, view: string, sizeName: string): string {
  return `${project(projectName)}-${namePart(view) || 'view'}-${namePart(sizeName) || 'size'}.png`;
}
