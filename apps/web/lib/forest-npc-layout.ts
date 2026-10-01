/** Screen-space layout, independent of camera zoom and device density. */
export function forestNPCBubblePoint(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const margin = 8;
  const safeWidth = Math.min(Math.max(0, width), Math.max(0, viewportWidth - margin * 2));
  const safeHeight = Math.min(Math.max(0, height), Math.max(0, viewportHeight - margin * 2));
  return {
    x: Math.max(margin + safeWidth / 2, Math.min(viewportWidth - margin - safeWidth / 2, x)),
    y: Math.max(margin + safeHeight, Math.min(viewportHeight - margin, y)),
  };
}
