import { createFileRoute } from "@tanstack/react-router";

import { CANONICAL_ORIGIN, routeHead } from "@/lib/route-head";

const DESCRIPTION =
  "A flashcard trainer for memorizing every 3x3 Rubik's Cube OLL and PLL algorithm.";

const CFLOP_APPLICATION = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "CFLOP",
  description: DESCRIPTION,
  url: CANONICAL_ORIGIN,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any",
  // A free app still needs a priced offer to be rich-result eligible.
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export const Route = createFileRoute("/")({
  head: () =>
    routeHead({
      path: "/",
      title: "CFLOP - Home",
      description: DESCRIPTION,
      indexable: true,
      jsonLd: CFLOP_APPLICATION,
    }),
});
