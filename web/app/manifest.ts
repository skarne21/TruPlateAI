import type { MetadataRoute } from "next";

/** Makes the app installable on a phone home screen.
 *
 * This is the difference between "a website you visit" and something you use
 * four times a day. Installed, it opens without browser chrome and the camera
 * is one tap from the home screen -- which is the whole logging flow.
 *
 * `start_url` is the log screen rather than the dashboard: opening the app is
 * almost always because you just ate something.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TruPlate AI",
    short_name: "TruPlate",
    description:
      "Log meals by photo, text or voice. Foods identified by AI, macros grounded in the USDA database.",
    start_url: "/log",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches the design tokens in globals.css so the splash and status bar
    // don't flash a colour the app never uses.
    background_color: "#faf6ee",
    theme_color: "#e85d2c",
    categories: ["health", "fitness", "food"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Log a meal", short_name: "Log", url: "/log" },
      { name: "Weigh in", short_name: "Weigh-in", url: "/weight" },
    ],
  };
}
