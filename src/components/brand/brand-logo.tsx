import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

const VARIANTS = {
  /** Purple + star - default on light UI */
  color: "/brand/euzim-logo-color.png",
  /** Dark strokes - light backgrounds when color is too busy */
  mono: "/brand/euzim-logo-mono.png",
  /** Logo preta sólida (RGB ~18) - branding inline / fundos claros */
  black: "/brand/euzim-logo-black.png",
  /** White wordmark - dark / immersive backgrounds */
  onDark: "/brand/euzim-logo-on-dark.png",
} as const;

const SIZES = {
  /** App shell / marketing header — alinhado à altura dos botões sm */
  header: { height: 28, width: 84, className: "h-7 w-auto" },
  /** Login / signup */
  auth: { height: 72, width: 192, className: "h-14 w-auto sm:h-16" },
  /** Compact chips, onboarding pill, reader chrome */
  compact: { height: 24, width: 72, className: "h-6 w-auto" },
  /** Inline no fluxo de texto (~1em via className) */
  inline: { height: 28, width: 72, className: "h-[1.05em] w-auto" },
} as const;

export type BrandLogoVariant = keyof typeof VARIANTS;
export type BrandLogoSize = keyof typeof SIZES;

export function BrandLogo({
  variant = "color",
  size = "header",
  href = "/",
  className,
  priority = false,
}: {
  variant?: BrandLogoVariant;
  size?: BrandLogoSize;
  /** Pass null to render without a link. */
  href?: string | null;
  className?: string;
  priority?: boolean;
}) {
  const src = VARIANTS[variant];
  const dims = SIZES[size];
  const img = (
    <Image
      src={src}
      alt="Euzim"
      width={dims.width}
      height={dims.height}
      priority={priority}
      className={cn("object-contain object-left", dims.className, className)}
      // width auto mantém proporção; altura vem só do className (h-*).
      // height:auto no style anulava h-7/h-8 e explodia a logo no header.
      style={{ width: "auto" }}
    />
  );

  if (href == null) {
    return (
      <span className="inline-flex items-center" aria-label="Euzim">
        {img}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Euzim"
    >
      {img}
    </Link>
  );
}
