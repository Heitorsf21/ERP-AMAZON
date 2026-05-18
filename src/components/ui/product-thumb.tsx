"use client";

import * as React from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Size = 32 | 40 | 48 | 56;

type Props = {
  src: string | null | undefined;
  alt: string;
  size?: Size;
  title?: string | null;
  className?: string;
};

const sizeClassMap: Record<Size, string> = {
  32: "h-8 w-8",
  40: "h-10 w-10",
  48: "h-12 w-12",
  56: "h-14 w-14",
};

const iconClassMap: Record<Size, string> = {
  32: "h-3.5 w-3.5",
  40: "h-4 w-4",
  48: "h-4 w-4",
  56: "h-5 w-5",
};

export function ProductThumb({ src, alt, size = 40, title, className }: Props) {
  const [erro, setErro] = React.useState(false);

  const sizeClass = sizeClassMap[size];
  const iconClass = iconClassMap[size];

  if (!src || erro) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border bg-muted shadow-sm",
          sizeClass,
          className,
        )}
      >
        <ImageOff className={cn("text-muted-foreground/60", iconClass)} />
      </span>
    );
  }

  const img = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      onError={() => setErro(true)}
      onLoad={(e) => {
        const w = (e.currentTarget as HTMLImageElement).naturalWidth;
        if (w > 0 && w < 50) setErro(true);
      }}
      className={cn(
        "shrink-0 rounded-md border bg-white object-contain shadow-sm",
        sizeClass,
        className,
      )}
    />
  );

  if (!title) return img;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{img}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-[280px] text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}
