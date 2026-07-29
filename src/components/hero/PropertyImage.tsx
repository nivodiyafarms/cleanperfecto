import Image from "next/image";
import type { PropertyType } from "@/lib/property-types";

export default function PropertyImage({
  property,
  priority = false,
}: {
  property: PropertyType;
  priority?: boolean;
}) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-3xl border border-border bg-background-alt">
      <Image
        key={property.id}
        src={property.image.src}
        alt={property.image.alt}
        fill
        priority={priority}
        sizes="(min-width: 1024px) 28rem, (min-width: 640px) 60vw, 90vw"
        className="object-cover"
      />
    </div>
  );
}
