import posthog from "posthog-js";

console.log("checking environment")
if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "development") {
  console.log("Initiating posthog")
  console.log(process.env.NODE_ENV)
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2025-05-24",
  });
}
