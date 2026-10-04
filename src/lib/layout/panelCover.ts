export interface PanelRect {
  top: number;
  left: number;
}

export function bottomCover(rect: PanelRect, viewportHeight: number): number {
  return rect.left <= 0 ? Math.max(0, viewportHeight - rect.top) : 0;
}

export function centeredScrollTop(
  scrollY: number,
  targetTop: number,
  targetHeight: number,
  visibleTop: number,
  visibleBottom: number,
): number {
  return scrollY + targetTop + targetHeight / 2 - (visibleTop + visibleBottom) / 2;
}

export function bottomAlignedScrollTop(
  scrollY: number,
  targetBottom: number,
  visibleBottom: number,
): number {
  return scrollY + targetBottom - visibleBottom;
}
