/**
 * White-label theming contract (docs/figma/ui-ux-handoff.md section 6).
 * Approved design tokens only - never arbitrary CSS.
 */
import { z } from "zod";

export const TenantThemeSchema = z.object({
  displayName: z.string(),
  logoAssetKey: z.string().optional(),
  primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  primaryContrast: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  success: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  warning: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  danger: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  customDomain: z.string().optional(),
});
export type TenantTheme = z.infer<typeof TenantThemeSchema>;

/** Default dispatcher theme from the Figma design system. */
export const DEFAULT_THEME: TenantTheme = {
  displayName: "PrivateFleet",
  primary: "#4F8CFF",
  primaryContrast: "#0F172A",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
};
