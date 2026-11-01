import type { ReactElement, SVGProps } from "react";

/**
 * Replaceable section icons for the Prowess Field Manual sheet (PAS-9.9 M6-WO5 §70). Each is a small inline SVG drawn in
 * `currentColor`, decorative by default (`aria-hidden`); a section's meaning is always carried by its text heading.
 * Swapping the Prowess iconography later means replacing this file — no artwork is baked into a background image.
 */
type IconProps = SVGProps<SVGSVGElement>;
const base = (props: IconProps, children: ReactElement | ReactElement[]) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    {children}
  </svg>
);

export const CompassStar = (p: IconProps) => base(p, [<path key="a" d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" />, <circle key="b" cx="12" cy="12" r="1.6" />]);
export const StatsIcon = (p: IconProps) => base(p, [<path key="a" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />]);
export const ShieldIcon = (p: IconProps) => base(p, [<path key="a" d="M12 3l8 3v5c0 5-3.5 8.5-8 9.9-4.5-1.5-8-5-8-10V6z" />, <path key="b" d="M12 3v18M4 11h16" />]);
export const DropIcon = (p: IconProps) => base(p, [<path key="a" d="M12 3c3 4.5 6 7.6 6 11a6 6 0 01-12 0c0-3.4 3-6.5 6-11z" />]);
export const SkillsIcon = (p: IconProps) => base(p, [<path key="a" d="M12 2l2.5 5.5L20 8l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />]);
export const SwordsIcon = (p: IconProps) => base(p, [<path key="a" d="M4 4l10 10M4 4h4M4 4v4M20 4L10 14M20 4h-4M20 4v4M7 17l-3 3M17 17l3 3M8 14l2 2M16 14l-2 2" />]);
export const EffectsIcon = (p: IconProps) => base(p, [<path key="a" d="M12 2l3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z" />]);
export const TriadIcon = (p: IconProps) => base(p, [<circle key="a" cx="12" cy="8" r="4" />, <circle key="b" cx="8" cy="14.9" r="4" />, <circle key="c" cx="16" cy="14.9" r="4" />]);
export const GearIcon = (p: IconProps) => base(p, [<path key="a" d="M5 8h14l-1.5 12h-11z" />, <path key="b" d="M9 8V6a3 3 0 016 0v2" />]);
export const RingIcon = (p: IconProps) => base(p, [<circle key="a" cx="12" cy="14" r="6" />, <path key="b" d="M9 5l3-3 3 3-3 3z" />]);
export const WeightIcon = (p: IconProps) => base(p, [<path key="a" d="M6 9h12l2 11H4z" />, <circle key="b" cx="12" cy="6" r="2.5" />]);
export const SatchelIcon = (p: IconProps) => base(p, [<rect key="a" x="4" y="8" width="16" height="12" rx="2" />, <path key="b" d="M9 8V6a3 3 0 016 0v2M4 12h16" />]);
export const QuillIcon = (p: IconProps) => base(p, [<path key="a" d="M20 3C12 4 7 9 5 17l-1 4 4-1c8-2 13-7 12-17z" />, <path key="b" d="M5 17l7-7" />]);
export const PlusIcon = (p: IconProps) => base(p, [<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M12 8v8M8 12h8" />]);
export const BoltIcon = (p: IconProps) => base(p, [<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M13 6l-4 7h4l-2 5 5-8h-4z" />]);
export const DiamondIcon = (p: IconProps) => base(p, [<path key="a" d="M12 4l6 8-6 8-6-8z" />]);
export const PaperclipIcon = (p: IconProps) => base({ viewBox: "0 0 24 48", ...p }, [<path key="a" d="M8 6v30a4 4 0 008 0V8a6 6 0 00-12 0v26" />]);

/** The subdued personnel silhouette shown when a Character has no portrait (§14). */
export function PersonnelSilhouette(props: IconProps) {
  return (
    <svg viewBox="0 0 100 120" aria-hidden="true" focusable="false" {...props}>
      <rect width="100" height="120" fill="#8f8a80" />
      <circle cx="50" cy="44" r="20" fill="#5e5a54" />
      <path d="M12 120c2-26 18-40 38-40s36 14 38 40z" fill="#5e5a54" />
    </svg>
  );
}

/** The small equipment mannequin (§56) — presentation only; WO6 may make its gear locations interactive. */
export function EquipmentFigure(props: IconProps) {
  return (
    <svg viewBox="0 0 80 160" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.4} {...props}>
      <circle cx="40" cy="40" r="34" strokeDasharray="2 4" opacity=".45" />
      <circle cx="40" cy="20" r="9" />
      <path d="M28 34h24l6 34-8 4-4 34h-12l-4-34-8-4z" />
      <path d="M28 34l-9.9 30M52 34l10 30M34 106l-2 44M46 106l2 44" />
      <path d="M22 64l-6 50M58 64l6 50" opacity=".6" />
    </svg>
  );
}
